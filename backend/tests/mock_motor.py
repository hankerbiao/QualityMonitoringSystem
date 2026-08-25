"""
Async Motor-compatible in-memory mock for testing.
Provides Motor-like async interface backed by plain Python dicts.
"""

import re
from typing import Any


class MockAsyncCursor:
    """Async cursor that mimics Motor's AsyncIOMotorCursor."""

    def __init__(
        self,
        collection: "MockMotorCollection",
        filter_spec: dict[str, Any],
        sort_spec: list | None = None,
        skip_val: int = 0,
        limit_val: int | None = None,
    ):
        self._coll = collection
        self._filter = filter_spec
        self._sort = sort_spec
        self._skip = skip_val
        self._limit = limit_val
        self._closed = False

    def sort(self, key_or_list: Any, direction: int = 1) -> "MockAsyncCursor":
        if isinstance(key_or_list, str):
            self._sort = [(key_or_list, direction)]
        elif isinstance(key_or_list, list):
            self._sort = key_or_list
        else:
            self._sort = key_or_list
        return self

    def skip(self, n: int) -> "MockAsyncCursor":
        self._skip = n
        return self

    def limit(self, n: int) -> "MockAsyncCursor":
        self._limit = n
        return self

    async def to_list(self, length: int | None = None) -> list[dict]:
        docs = list(self._coll._query(self._filter))
        if self._sort:
            docs = self._coll._apply_sort(docs, self._sort)
        if self._skip:
            docs = docs[self._skip :]
        if self._limit is not None:
            docs = docs[: self._limit]
        if length:
            docs = docs[:length]
        return docs

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not hasattr(self, "_iter_docs"):
            docs = await self.to_list()
            self._iter_docs = iter(docs)
        try:
            return next(self._iter_docs)
        except StopIteration:
            raise StopAsyncIteration from None


class MockAsyncAggregateCursor:
    """Async cursor for aggregation pipelines."""

    def __init__(self, collection: "MockMotorCollection", pipeline: list[dict]):
        self._coll = collection
        self._pipeline = pipeline
        self._results: list[dict] | None = None

    async def to_list(self, length: int | None = None) -> list[dict]:
        if self._results is None:
            self._results = self._coll._aggregate(self._pipeline)
        result = self._results
        if length:
            result = result[:length]
        return result

    async def __aiter__(self):
        results = await self.to_list()
        for doc in results:
            yield doc


class MockInsertOneResult:
    def __init__(self, inserted_id: Any):
        self.inserted_id = inserted_id


class MockInsertManyResult:
    def __init__(self, inserted_ids: list[Any]):
        self.inserted_ids = inserted_ids
        self.inserted_count = len(inserted_ids)


class MockUpdateResult:
    def __init__(self, matched_count: int = 0, modified_count: int = 0, upserted_id: Any = None):
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class MockDeleteResult:
    def __init__(self, deleted_count: int = 0):
        self.deleted_count = deleted_count


class MockBulkWriteResult:
    """Result object returned by bulk_write (only matched/upserted counts used)."""

    def __init__(
        self,
        inserted_count: int = 0,
        matched_count: int = 0,
        modified_count: int = 0,
        upserted_count: int = 0,
        deleted_count: int = 0,
    ):
        self.inserted_count = inserted_count
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.upserted_count = upserted_count
        self.deleted_count = deleted_count
        self.bulk_api_result = {
            "writeErrors": [],
            "writeConcernErrors": [],
            "nInserted": inserted_count,
            "nUpserted": upserted_count,
            "nMatched": matched_count,
            "nModified": modified_count,
            "nRemoved": deleted_count,
        }


class MockMotorCollection:
    """In-memory async collection mimicking Motor's AsyncIOMotorCollection."""

    def __init__(self, name: str, db: "MockMotorDatabase"):
        self._name = name
        self._db = db
        self._docs: dict[str, dict] = {}  # _id (str) -> doc

    # ── Query helpers ───────────────────────────────────────────────────────

    DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

    def _cmp(self, left, right) -> int:
        """Compare two values: date strings chronologically, otherwise lexically."""
        lv, rv = str(left), str(right)
        if self.DATE_RE.match(lv) and self.DATE_RE.match(rv):
            return (lv > rv) - (lv < rv)
        return (lv > rv) - (lv < rv)

    @staticmethod
    def _get_path(doc: dict, path: str) -> Any:
        """支持点路径 (如 "data.CPXH") 的字段读取，缺失返回 None。"""
        cur: Any = doc
        for part in path.split("."):
            if isinstance(cur, dict) and part in cur:
                cur = cur[part]
            else:
                return None
        return cur

    @staticmethod
    def _set_path(doc: dict, path: str, value: Any) -> None:
        parts = path.split(".")
        current = doc
        for part in parts[:-1]:
            current = current.setdefault(part, {})
        current[parts[-1]] = value

    def _match(self, doc: dict, filter_spec: dict, variables: dict[str, Any] | None = None) -> bool:
        for key, val in filter_spec.items():
            if key == "$or":
                if not any(self._match(doc, branch, variables) for branch in val):
                    return False
                continue
            if key == "$and":
                if not all(self._match(doc, branch, variables) for branch in val):
                    return False
                continue
            if key == "$expr":
                if not self._eval_expr(val, doc, variables):
                    return False
                continue
            if key == "$regex":
                flags = filter_spec.get("$options", "")
                pattern = re.compile(val, flags=flags)
                if not pattern.search(str(doc.get(key, ""))):
                    return False
                continue
            doc_val = self._get_path(doc, key)
            if isinstance(val, dict):
                matched = True
                for op, dv in val.items():
                    if op == "$regex":
                        if not re.search(
                            dv,
                            str(doc_val or ""),
                            flags=re.IGNORECASE if val.get("$options") == "i" else 0,
                        ):
                            matched = False
                    elif op == "$exists":
                        exists = self._get_path(doc, key) is not None
                        if exists != dv:
                            matched = False
                    if (
                        op == "$gte"
                        and self._cmp(doc_val, dv) < 0
                        or op == "$lte"
                        and self._cmp(doc_val, dv) > 0
                        or op == "$gt"
                        and self._cmp(doc_val, dv) <= 0
                        or op == "$lt"
                        and self._cmp(doc_val, dv) >= 0
                        or op == "$in"
                        and doc_val not in dv
                        or op == "$nin"
                        and doc_val in dv
                    ):
                        matched = False
                if not matched:
                    return False
            else:
                if doc_val != val:
                    return False
        return True

    def _query(self, filter_spec: dict) -> list[dict]:
        if not filter_spec:
            return list(self._docs.values())
        return [doc for doc in self._docs.values() if self._match(doc, filter_spec)]

    def _apply_sort(self, docs: list[dict], sort_spec: list) -> list[dict]:
        key, direction = sort_spec[0]

        def sort_key(doc: dict):
            return self._get_path(doc, key) or ""

        # Stable sort（仅按首个排序键，足以覆盖测试场景）
        return sorted(docs, key=sort_key, reverse=(direction == -1))

    # ── 聚合表达式求值 ───────────────────────────────────────────────────────

    def _eval_expr(self, expr: Any, doc: dict, variables: dict[str, Any] | None = None) -> Any:
        """求值测试中使用到的 Mongo 聚合表达式子集。"""
        if isinstance(expr, str):
            if expr == "$$ROOT":
                return doc
            if expr.startswith("$$"):
                return (variables or {}).get(expr[2:])
            if expr.startswith("$"):
                return self._get_path(doc, expr[1:])
            return expr
        if isinstance(expr, dict):
            if "$ifNull" in expr:
                value = self._eval_expr(expr["$ifNull"][0], doc, variables)
                return (
                    value
                    if value is not None
                    else self._eval_expr(expr["$ifNull"][1], doc, variables)
                )
            if "$convert" in expr:
                spec = expr["$convert"]
                value = self._eval_expr(spec.get("input"), doc, variables)
                if value is None:
                    return spec.get("onNull")
                try:
                    return float(value)
                except (TypeError, ValueError):
                    return spec.get("onError")
            if "$toString" in expr:
                value = self._eval_expr(expr["$toString"], doc, variables)
                return str(value) if value is not None else None
            if "$concat" in expr:
                return "".join(
                    str(self._eval_expr(item, doc, variables) or "") for item in expr["$concat"]
                )
            if "$substrBytes" in expr or "$substr" in expr:
                args = expr.get("$substrBytes") or expr.get("$substr")
                field_val = self._eval_expr(args[0], doc, variables)
                return str(field_val or "")[args[1] : args[1] + args[2]]
            if "$eq" in expr:
                return self._eval_expr(expr["$eq"][0], doc, variables) == self._eval_expr(
                    expr["$eq"][1], doc, variables
                )
            if "$ne" in expr:
                return self._eval_expr(expr["$ne"][0], doc, variables) != self._eval_expr(
                    expr["$ne"][1], doc, variables
                )
            if "$gt" in expr:
                return self._eval_expr(expr["$gt"][0], doc, variables) > self._eval_expr(
                    expr["$gt"][1], doc, variables
                )
            if "$gte" in expr:
                return self._eval_expr(expr["$gte"][0], doc, variables) >= self._eval_expr(
                    expr["$gte"][1], doc, variables
                )
            if "$lt" in expr:
                return self._eval_expr(expr["$lt"][0], doc, variables) < self._eval_expr(
                    expr["$lt"][1], doc, variables
                )
            if "$lte" in expr:
                return self._eval_expr(expr["$lte"][0], doc, variables) <= self._eval_expr(
                    expr["$lte"][1], doc, variables
                )
            if "$size" in expr:
                value = self._eval_expr(expr["$size"], doc, variables)
                return len(value) if isinstance(value, list) else 0
            if "$cond" in expr:
                condition, truthy, falsy = expr["$cond"]
                return self._eval_expr(
                    truthy if self._eval_expr(condition, doc, variables) else falsy,
                    doc,
                    variables,
                )
            if "$replaceAll" in expr:
                spec = expr["$replaceAll"]
                text = str(self._eval_expr(spec.get("input"), doc, variables) or "")
                # find/replacement 在业务表达式中均为字面量（如转义正则元字符），
                # 直接按字面处理，避免把单个 "$" 误解析成字段路径。
                find_value = spec.get("find") or ""
                if isinstance(find_value, dict) and "$literal" in find_value:
                    find_value = find_value["$literal"]
                find = str(find_value)
                repl = str(spec.get("replacement") or "")
                return text.replace(find, repl)
            if "$and" in expr:
                return all(self._eval_expr(item, doc, variables) for item in expr["$and"])
            if "$or" in expr:
                return any(self._eval_expr(item, doc, variables) for item in expr["$or"])
            if "$regexMatch" in expr:
                spec = expr["$regexMatch"]
                value = str(self._eval_expr(spec.get("input"), doc, variables) or "")
                pattern = str(self._eval_expr(spec.get("regex"), doc, variables) or "")
                flags = re.IGNORECASE if "i" in spec.get("options", "") else 0
                return re.search(pattern, value, flags) is not None
            return {key: self._eval_expr(value, doc, variables) for key, value in expr.items()}
        return expr

    def _group(self, docs: list[dict], group_spec: dict) -> list[dict]:
        groups: dict[Any, dict] = {}
        raw_keys: dict[Any, Any] = {}
        for doc in docs:
            raw_key = self._eval_expr(group_spec["_id"], doc)
            g_key = tuple(sorted(raw_key.items())) if isinstance(raw_key, dict) else raw_key
            raw_keys.setdefault(g_key, raw_key)
            if g_key not in groups:
                groups[g_key] = {"_id": raw_keys[g_key]}
            for field, op_expr in group_spec.items():
                if field == "_id":
                    continue
                for op, src in op_expr.items():
                    if op == "$sum":
                        groups[g_key].setdefault(field, 0)
                        if isinstance(src, int | float):
                            groups[g_key][field] += src
                        else:
                            value = self._eval_expr(src, doc)
                            groups[g_key][field] += value or 0
                    elif op == "$first":
                        groups[g_key].setdefault(field, self._eval_expr(src, doc))
        return list(groups.values())

    def _run_pipeline(
        self,
        docs: list[dict],
        pipeline: list[dict],
        variables: dict[str, Any] | None = None,
    ) -> list[dict]:
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if self._match(d, stage["$match"], variables)]
            elif "$project" in stage:
                projected = []
                for doc in docs:
                    result = {}
                    for field, expression in stage["$project"].items():
                        if expression == 0:
                            continue
                        if expression == 1:
                            value = self._get_path(doc, field)
                        else:
                            value = self._eval_expr(expression, doc, variables)
                        if value is not None:
                            self._set_path(result, field, value)
                    projected.append(result)
                docs = projected
            elif "$lookup" in stage:
                spec = stage["$lookup"]
                foreign = self._db[spec["from"]]
                joined = []
                for doc in docs:
                    local_vars = {
                        key: self._eval_expr(value, doc, variables)
                        for key, value in spec.get("let", {}).items()
                    }
                    copy = dict(doc)
                    copy[spec["as"]] = foreign._run_pipeline(
                        list(foreign._docs.values()), spec.get("pipeline", []), local_vars
                    )
                    joined.append(copy)
                docs = joined
            elif "$unwind" in stage:
                path = stage["$unwind"]
                path = path["path"] if isinstance(path, dict) else path
                path = path.lstrip("$")
                unwound = []
                for doc in docs:
                    values = self._get_path(doc, path)
                    if not isinstance(values, list):
                        continue
                    for value in values:
                        copy = dict(doc)
                        self._set_path(copy, path, value)
                        unwound.append(copy)
                docs = unwound
            elif "$group" in stage:
                docs = self._group(docs, stage["$group"])
            elif "$sort" in stage:
                sort_list = [(k, v) for k, v in stage["$sort"].items()]
                docs = self._apply_sort(docs, sort_list)
            elif "$skip" in stage:
                docs = docs[stage["$skip"] :]
            elif "$limit" in stage:
                docs = docs[: stage["$limit"]]
            elif "$count" in stage:
                docs = [{stage["$count"]: len(docs)}]
            elif "$facet" in stage:
                out: dict[str, list] = {}
                for fname, fpipe in stage["$facet"].items():
                    out[fname] = self._run_pipeline(list(docs), fpipe, variables)
                docs = [out]
        return docs

    def _aggregate(self, pipeline: list[dict]) -> list[dict]:
        return self._run_pipeline(list(self._docs.values()), pipeline)

    # ── Async Motor API ─────────────────────────────────────────────────────

    async def find_one(self, filter_spec: dict | None = None, **kwargs) -> dict | None:
        docs = self._query(filter_spec or {})
        return docs[0] if docs else None

    def find(self, filter_spec: dict | None = None, *args, **kwargs) -> MockAsyncCursor:
        return MockAsyncCursor(self, filter_spec or {})

    async def insert_one(self, doc: dict) -> MockInsertOneResult:
        from bson import ObjectId

        doc = dict(doc)
        if "_id" not in doc:
            doc["_id"] = str(ObjectId())
        self._docs[doc["_id"]] = doc
        return MockInsertOneResult(doc["_id"])

    async def insert_many(self, docs: list[dict]) -> MockInsertManyResult:
        from bson import ObjectId

        ids = []
        for doc in docs:
            doc = dict(doc)
            if "_id" not in doc:
                doc["_id"] = str(ObjectId())
            self._docs[doc["_id"]] = doc
            ids.append(doc["_id"])
        return MockInsertManyResult(ids)

    async def update_one(
        self,
        filter_spec: dict,
        update: dict,
        upsert: bool = False,
    ) -> MockUpdateResult:
        docs = self._query(filter_spec)
        if not docs:
            if upsert:
                from bson import ObjectId

                new_doc = dict(filter_spec)
                if "$set" in update:
                    new_doc.update(update["$set"])
                if "_id" not in new_doc:
                    new_doc["_id"] = str(ObjectId())
                self._docs[new_doc["_id"]] = new_doc
                return MockUpdateResult(matched_count=1, upserted_id=new_doc["_id"])
            return MockUpdateResult()

        doc = docs[0]
        if "$set" in update:
            doc.update(update["$set"])
        elif "$setOnInsert" in update:
            pass  # Only set if new
        self._docs[doc["_id"]] = doc
        return MockUpdateResult(matched_count=1, modified_count=1)

    async def delete_one(self, filter_spec: dict) -> MockDeleteResult:
        docs = self._query(filter_spec)
        if not docs:
            return MockDeleteResult()
        doc = docs[0]
        del self._docs[doc["_id"]]
        return MockDeleteResult(deleted_count=1)

    async def delete_many(self, filter_spec: dict) -> MockDeleteResult:
        docs = self._query(filter_spec)
        count = len(docs)
        for doc in docs:
            del self._docs[doc["_id"]]
        return MockDeleteResult(deleted_count=count)

    async def count_documents(self, filter_spec: dict) -> int:
        return len(self._query(filter_spec))

    async def estimated_document_count(self) -> int:
        return len(self._docs)

    def aggregate(self, pipeline: list[dict]) -> MockAsyncAggregateCursor:
        return MockAsyncAggregateCursor(self, pipeline)

    async def create_index(self, keys: list, **kwargs) -> str:
        return "ok"  # No-op for mock

    async def bulk_write(self, operations: list) -> "MockBulkWriteResult":
        """Process a list of pymongo write operations (UpdateOne supported).

        Handles $set / $setOnInsert / $inc so the sales-order upsert tests work.
        """
        from pymongo import UpdateOne

        inserted = matched = modified = upserted = 0
        for op in operations:
            if isinstance(op, UpdateOne):
                f = op._filter
                u = op._doc
                upsert = op._upsert
                docs = self._query(f)
                if docs:
                    doc = docs[0]
                    if "$set" in u:
                        doc.update(u["$set"])
                    if "$inc" in u:
                        for k, v in u["$inc"].items():
                            doc[k] = doc.get(k, 0) + v
                    # $setOnInsert 仅对新文档生效，已存在时忽略
                    self._docs[doc["_id"]] = doc
                    matched += 1
                    modified += 1
                elif upsert:
                    new_doc = dict(f)
                    if "$set" in u:
                        new_doc.update(u["$set"])
                    if "$setOnInsert" in u:
                        new_doc.update(u["$setOnInsert"])
                    if "$inc" in u:
                        for k, v in u["$inc"].items():
                            new_doc[k] = new_doc.get(k, 0) + v
                    from bson import ObjectId

                    if "_id" not in new_doc:
                        new_doc["_id"] = str(ObjectId())
                    self._docs[new_doc["_id"]] = new_doc
                    upserted += 1
                    inserted += 1
        return MockBulkWriteResult(
            inserted_count=inserted,
            matched_count=matched,
            modified_count=modified,
            upserted_count=upserted,
        )


class MockMotorDatabase:
    """In-memory async database mimicking Motor's AsyncIOMotorDatabase."""

    def __init__(self, name: str):
        self._name = name
        self._collections: dict[str, MockMotorCollection] = {}

    def __getitem__(self, name: str) -> MockMotorCollection:
        if name not in self._collections:
            self._collections[name] = MockMotorCollection(name, self)
        return self._collections[name]

    def __getattr__(self, name: str) -> MockMotorCollection:
        return self[name]

    def collection_names(self) -> list[str]:
        return list(self._collections.keys())


class MockMotorClient:
    """In-memory async client mimicking Motor's AsyncIOMotorClient."""

    def __init__(self, host: str = None, **kwargs):
        self._databases: dict[str, MockMotorDatabase] = {}

    def __getitem__(self, name: str) -> MockMotorDatabase:
        if name not in self._databases:
            self._databases[name] = MockMotorDatabase(name)
        return self._databases[name]

    def close(self) -> None:
        pass
