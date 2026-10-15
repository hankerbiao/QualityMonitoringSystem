# DOA Report-Repair Rate Contract

## Metric

`DOA report-repair rate = qualified SCS problem-batch quantity / SAP shipped quantity * 100%`.

The metric is calculated only when both sources are available under the same
5000-company sales-order scope.

## Numerator

Read `SCS_DOA` through the data gateway with `company5000=true` and
`judgment=是`. The BFF repeats both checks after normalization, then sums
`problem_batch_number`. A record whose sales order is absent from the eligible
SAP shipment scope is excluded and reported through `excludedRepairRecords`.

## Denominator

The data gateway `GET /api/orders` paginated response used by DOA must support
`company5000=true` and `shipmentOnly=true` and return these fields on every
item:

| Field | Meaning |
| --- | --- |
| `is5000Company` | The sales-order shipment belongs to the 5000-company scope. |
| `shipmentDate` | Actual SAP shipment date, in `YYYY-MM-DD` format. |
| `shipmentQuantity` | Actual SAP shipment quantity for the returned shipment line. |

`plannedStartDate`, `orderQuantity`, `storageQuantity`, `GSTRS`, and `WMENG`
are not substitutes. They describe planning, order, or inbound inventory data
and must never be used as the DOA denominator.

The BFF rejects the metric request when the required gateway fields are absent.
This prevents a plausible-looking but incorrect rate during incomplete upstream
migration.

## Replacement Rate

`DOA replacement rate = replacement defect quantity / SAP shipped quantity * 100%`.

The denominator and qualified DOA scope are exactly the same as the report-repair
rate. A qualified DOA contributes its `problem_batch_number` to the replacement
defect quantity only when its service number matches a non-revoked SCS change
record whose `change_type` is `换上` or `换上-up`. This counts an installed
hardware replacement once per DOA record and prevents cancelled or removal-only
operations from qualifying the record.

## Aggregation Rules

- Sum shipment lines for the headline denominator and shipment-date trend.
- Link SCS records to the normalized sales-order number, ignoring numeric
  leading zeros.
- Count each qualified SCS record once and use its `problem_batch_number` as
  the numerator contribution.
- When one sales order spans multiple customer, model, or shipment-date rows,
  do not select an arbitrary final row. Sum its shipment quantity and leave the
  ambiguous repair dimension/date unclassified.

## Acceptance Cases

1. A 5000-company SCS record with `judgment=否` contributes zero.
2. A non-5000 shipment contributes zero to the denominator, even when the
   sales-order number appears in SCS.
3. A response lacking any required shipment field returns a gateway contract
   error rather than a rate.
4. Repeated SAP rows for one sales order are summed without last-row overwrite.
5. A matched, non-revoked `换上` DOA record with `problem_batch_number=2` contributes
   2 to the replacement numerator; revoked and `换下`-only records contribute zero.
