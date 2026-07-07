"""
Async Motor-compatible in-memory mock for testing.
Provides Motor-like async interface backed by plain Python dicts.
"""
import asyncio
import re
from typing import Any, Optional, Dict, List, Union


class MockAsyncCursor:
    """Async cursor that mimics Motor's AsyncIOMotorCursor."""

    def __init__(
        self,
        collection: "MockMotorCollection",
        filter_spec: Dict[str, Any],
        sort_spec: Optional[List] = None,
        skip_val: int = 0,
        limit_val: Optional[int] = None,
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

    async def to_list(self, length: Optional[int] = None) -> List[Dict]:
        docs = list(self._coll._query(self._filter))
        if self._sort:
            docs = self._coll._apply_sort(docs, self._sort)
        if self._skip:
            docs = docs[self._skip:]
        if self._limit is not None:
            docs = docs[: self._limit]
        if length:
            docs = docs[:length]
        return docs

    async def __aiter__(self):
        return self

    async def __anext__(self):
        if not hasattr(self, "_iter_docs"):
            docs = await self.to_list()
            self._iter_docs = iter(docs)
        try:
            return next(self._iter_docs)
        except StopIteration:
            raise StopAsyncIteration


class MockAsyncAggregateCursor:
    """Async cursor for aggregation pipelines."""

    def __init__(self, collection: "MockMotorCollection", pipeline: List[Dict]):
        self._coll = collection
        self._pipeline = pipeline
        self._results: Optional[List[Dict]] = None

    async def to_list(self, length: Optional[int] = None) -> List[Dict]:
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
    def __init__(self, inserted_ids: List[Any]):
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


class MockMotorCollection:
    """In-memory async collection mimicking Motor's AsyncIOMotorCollection."""

    def __init__(self, name: str, db: "MockMotorDatabase"):
        self._name = name
        self._db = db
        self._docs: Dict[str, Dict] = {}  # _id (str) -> doc

    # ── Query helpers ───────────────────────────────────────────────────────

    def _match(self, doc: Dict, filter_spec: Dict) -> bool:
        for key, val in filter_spec.items():
            if key == "$regex":
                flags = filter_spec.get("$options", "")
                pattern = re.compile(val, flags=flags)
                if not pattern.search(str(doc.get(key, ""))):
                    return False
            elif isinstance(val, dict):
                op = next(iter(val.keys()))
                dv = val[op]
                if op == "$gte" and not (doc.get(key, "") >= dv):
                    return False
                elif op == "$lte" and not (doc.get(key, "") <= dv):
                    return False
                elif op == "$gt" and not (doc.get(key, "") > dv):
                    return False
                elif op == "$lt" and not (doc.get(key, "") < dv):
                    return False
                elif op == "$in":
                    if doc.get(key) not in dv:
                        return False
            else:
                if doc.get(key) != val:
                    return False
        return True

    def _query(self, filter_spec: Dict) -> List[Dict]:
        if not filter_spec:
            return list(self._docs.values())
        return [doc for doc in self._docs.values() if self._match(doc, filter_spec)]

    def _apply_sort(self, docs: List[Dict], sort_spec: List) -> List[Dict]:
        def sort_key(doc: Dict):
            key, direction = sort_spec[0]
            val = doc.get(key, "")
            return val

        # Stable sort
        return sorted(docs, key=sort_key)

    def _aggregate(self, pipeline: List[Dict]) -> List[Dict]:
        docs = list(self._docs.values())
        for stage in pipeline:
            if "$match" in stage:
                docs = [d for d in docs if self._match(d, stage["$match"])]
            elif "$group" in stage:
                group_spec = stage["$group"]
                groups: Dict[str, Dict] = {}
                for doc in docs:
                    g_key = doc.get(group_spec["_id"].lstrip("$"), "_missing")
                    if g_key not in groups:
                        groups[g_key] = {"_id": g_key}
                    for field, op_expr in group_spec.items():
                        if field == "_id":
                            continue
                        for op, src_field in op_expr.items():
                            if op == "$sum":
                                groups[g_key].setdefault(field, 0)
                                groups[g_key][field] += doc.get(src_field.lstrip("$"), 0)
                docs = list(groups.values())
            elif "$sort" in stage:
                sort_list = [(k, v) for k, v in stage["$sort"].items()]
                docs = self._apply_sort(docs, sort_list)
            elif "$limit" in stage:
                docs = docs[: stage["$limit"]]
        return docs

    # ── Async Motor API ─────────────────────────────────────────────────────

    async def find_one(self, filter_spec: Optional[Dict] = None, **kwargs) -> Optional[Dict]:
        docs = self._query(filter_spec or {})
        return docs[0] if docs else None

    def find(self, filter_spec: Optional[Dict] = None, *args, **kwargs) -> MockAsyncCursor:
        return MockAsyncCursor(self, filter_spec or {})

    async def insert_one(self, doc: Dict) -> MockInsertOneResult:
        from bson import ObjectId

        doc = dict(doc)
        if "_id" not in doc:
            doc["_id"] = str(ObjectId())
        self._docs[doc["_id"]] = doc
        return MockInsertOneResult(doc["_id"])

    async def insert_many(self, docs: List[Dict]) -> MockInsertManyResult:
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
        filter_spec: Dict,
        update: Dict,
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

    async def delete_one(self, filter_spec: Dict) -> MockDeleteResult:
        docs = self._query(filter_spec)
        if not docs:
            return MockDeleteResult()
        doc = docs[0]
        del self._docs[doc["_id"]]
        return MockDeleteResult(deleted_count=1)

    async def delete_many(self, filter_spec: Dict) -> MockDeleteResult:
        docs = self._query(filter_spec)
        count = len(docs)
        for doc in docs:
            del self._docs[doc["_id"]]
        return MockDeleteResult(deleted_count=count)

    async def count_documents(self, filter_spec: Dict) -> int:
        return len(self._query(filter_spec))

    def aggregate(self, pipeline: List[Dict]) -> MockAsyncAggregateCursor:
        return MockAsyncAggregateCursor(self, pipeline)

    async def create_index(self, keys: List, **kwargs) -> str:
        return "ok"  # No-op for mock


class MockMotorDatabase:
    """In-memory async database mimicking Motor's AsyncIOMotorDatabase."""

    def __init__(self, name: str):
        self._name = name
        self._collections: Dict[str, MockMotorCollection] = {}

    def __getitem__(self, name: str) -> MockMotorCollection:
        if name not in self._collections:
            self._collections[name] = MockMotorCollection(name, self)
        return self._collections[name]

    def __getattr__(self, name: str) -> MockMotorCollection:
        return self[name]

    def collection_names(self) -> List[str]:
        return list(self._collections.keys())


class MockMotorClient:
    """In-memory async client mimicking Motor's AsyncIOMotorClient."""

    def __init__(self, host: str = None, **kwargs):
        self._databases: Dict[str, MockMotorDatabase] = {}

    def __getitem__(self, name: str) -> MockMotorDatabase:
        if name not in self._databases:
            self._databases[name] = MockMotorDatabase(name)
        return self._databases[name]

    def close(self) -> None:
        pass