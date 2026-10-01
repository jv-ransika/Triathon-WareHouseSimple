# Temperature-aware inferred product catalogue

Updated: 1 October 2026.

## Current result

`products.csv` now contains **330 inferred product records**, each with one fixed `temp_requirement`: `ambient` or `chilled`. `order_products.csv` contains **194,366 order–product rows covering all 97,321 main orders**.

Every product assigned to an order has the same brand and temperature requirement as that original order. Unit counts match exactly. Weight and volume each remain within 1% of the original totals for every order.

These are inferred candidates, not verified real SKUs. Temperature labels are inherited from the original orders under the user's assumption that all products in an order require that order's temperature. The source data does not independently verify product-level identities or storage requirements.

## Source and scope

Source archive: `drive-download-20260926T041925Z-1-001(5).zip`.

SHA-256: `e65c7327591cb3561c96c6f90c6f2d202b8be5ff63ae9e0a9730edf03179596a`.

| Source file inside archive | Orders | Order dates |
|---|---:|---|
| data/Training Data/deliveries_train.csv | 92,307 | 2024-01-01 to 2026-02-14 |
| data/Test Data/task1_test_inputs.csv | 5,014 | 2026-02-16 to 2026-03-28 |
| Total | 97,321 | |

Original fields used: `delivery_id`, `brand`, `temp_requirement`, `order_units`, `order_weight_kg`, `order_volume_m3`. All main orders are included regardless of dispatch status. The 85 separate peak-day scenario orders are excluded. Original source data is unchanged.

Weight is in kilograms. Volume is in cubic metres (1 m³ = 1,000 litres). The physical meaning of a unit—item, carton or another handling unit—is not established.

## What changed from the 280-product version

The earlier catalogue grouped by brand only. Some Fresh candidates appeared in both chilled and ambient orders. Those shared candidates needed separate temperature-specific identities.

1. Join every existing order–product row to its original order using `order_id = delivery_id`.
2. Read the original order's `temp_requirement`.
3. Create one candidate for each observed `(base_product_id, temp_requirement)` pair.
4. Append `_AMB` for ambient or `_CHL` for chilled to the original candidate ID.
5. Point each order–product row to the matching new ID.
6. Keep its quantity, unit weight and unit volume unchanged.
7. Recompute totals and validate temperature and brand for every assignment.

**50 Fresh candidates were used in both temperature groups.** Splitting them adds 50 records: 280 + 50 = 330. This increases labelled candidate identities, not the number of underlying fitted weight–volume profiles. Products used in only one temperature group receive only that version. All 330 records are used.

No clustering or weight/volume refitting was needed for this update. The reconstructed numerical totals are unchanged. All IDs now have temperature suffixes, including candidates that only needed one version. `base_product_id` preserves the link to the previous catalogue.

| Brand | Temperature | Product records | Original orders |
|---|---|---:|---:|
| Fresh | ambient | 53 | 55,600 |
| Fresh | chilled | 52 | 37,031 |
| Style | ambient | 47 | 2,890 |
| Tech | ambient | 178 | 1,800 |
| **Total** | | **330** | **97,321** |

## File schemas and joins

### products.csv

| Column | Meaning |
|---|---|
| product_id | Unique temperature-specific inferred ID |
| brand | Fresh, Style or Tech |
| temp_requirement | ambient or chilled, fixed for this candidate |
| unit_weight_kg | Fitted weight per unit |
| unit_volume_m3 | Fitted volume per unit |
| base_product_id | Candidate ID in the original 280-product catalogue |
| basis | Origin of the fitted weight–volume candidate |
| temperature_basis | inherited_from_original_order |
| verified_real_sku | False for all rows |

`basis` can be `observed_single_unit`, `cluster_center`, `observed_average_extreme`, or `adaptive_observed_order_average`. These identify how attributes were fitted, not verification of a real product.

### order_products.csv

| Column | Meaning |
|---|---|
| order_id | Original delivery_id |
| product_id | Foreign key to products.csv |
| quantity | Positive integer count of candidate units |

Join on `product_id` to get temperature and physical attributes. Temperature is stored once in the product table. Repeated order IDs are intentional: an order has one or two product types. Do not remove these as duplicate orders. Product names, original SKU IDs, prices, stock levels and dimensions were not recovered.

Keep the full numerical precision in the CSVs. Rounding unit attributes may invalidate the tolerance.

## Assumptions

- Weight and volume add linearly across units, with no separate packaging or packing-efficiency adjustment.
- Quantities are integers and sum exactly to the original order unit count.
- An order uses products of its own brand only.
- **An order uses products with its own temperature requirement only.** Mixed-temperature orders are not modelled.
- Candidate unit weight, volume and temperature are fixed across assignments.
- At most two product types per order is a modelling restriction, not an observed SKU-level fact.
- The 1% weight and volume tolerance is an experimental choice, not an organiser-specified measurement tolerance.
- All training and test inputs were used for reconstruction. Reported fit is not a held-out prediction score.
- Temperature labelling does not validate a vehicle's refrigeration capability or any complete routing plan.

## Original inference method

The 280 underlying candidates were constructed separately by brand:

1. Retain 136 distinct one-unit Tech observations as candidates. There are no one-unit Fresh or Style orders.
2. Calculate order average weight and volume by dividing totals by unit count.
3. Divide these features by their brand medians and fit k-means with 8, 16 and 32 centres per brand, random_state=42 and n_init=10.
4. Enumerate integer mixtures of one or two candidate types for each observed unit count. Shortlist eight nearest mixtures in scaled feature space and select the smallest maximum relative error. This is a heuristic, not a proof of the globally optimal allocation.
5. Add observed average-unit points on the convex hull to cover the extremes, producing 262 candidates.
6. Add average-unit candidates for unresolved orders until all orders fit within 1%, producing 280 candidates.
7. Apply the temperature split described above to produce the current 330 records.

The original 280 were Fresh 55, Style 47 and Tech 178. The updated counts reflect temperature splitting, not a rerun to minimise catalogue size.

The 136 one-unit Tech candidates explain exactly only 1 of the 253 two-unit Tech orders when every candidate pair with repetition is checked. They are not a complete exact catalogue under an additive/no-noise interpretation.

## Validation evidence

| Check | Result |
|---|---|
| Unique original orders covered | 97,321 of 97,321 |
| Order–product rows | 194,366 |
| Product IDs unique and all mapping references valid | Passed |
| Positive integer quantities | Passed |
| Exact unit-count sum for every order | Passed |
| Product brand equals original order brand for every row | Passed |
| Product temperature equals original order temperature for every row | Passed |
| More than one temperature within an order | 0 orders |
| Weight or volume totals changed by the temperature split | 0 orders |
| Orders exceeding 1% in either weight or volume | 0 orders |
| Median of each order's larger relative error | 0.088162% |
| 95th percentile of each order's larger relative error | 0.305131% |
| Maximum relative error | 0.997747% |
| Numerical matches of both totals within absolute 1e-8 | 194 orders |

Checks were recomputed from exported CSVs against the original orders. Numerical consistency and temperature agreement do not establish real SKU identity, uniqueness or the smallest possible catalogue. Weight distribution is descriptive evidence, not independent confirmation.

For each order:

```text
sum(quantity) = original order_units
predicted_weight = sum(quantity * unit_weight_kg)
predicted_volume = sum(quantity * unit_volume_m3)
abs(predicted_weight - original_weight) / original_weight <= 0.01
abs(predicted_volume - original_volume) / original_volume <= 0.01
all assigned product temperatures = original temp_requirement
```

## Updated product unit-weight distribution

Each current temperature-specific product record is counted once. A split base candidate is counted once for ambient and once for chilled. This is not a shipped-unit or order-weight distribution.

| Weight range (kg) | Records |
|---|---:|
| Below 5 | 12 |
| 5 to below 10 | 81 |
| 10 to below 20 | 53 |
| 20 to below 50 | 6 |
| 50 to below 100 | 12 |
| 100 to below 200 | 84 |
| 200 to below 300 | 57 |
| 300 to below 400 | 19 |
| 400 and above | 6 |
| **Total** | **330** |

| Brand | Temperature | Minimum kg | Median kg | Maximum kg |
|---|---|---:|---:|---:|
| Fresh | ambient | 3.585 | 7.164 | 13.200 |
| Fresh | chilled | 3.585 | 7.225 | 13.200 |
| Style | ambient | 7.563 | 15.335 | 25.200 |
| Tech | ambient | 57.800 | 189.394 | 470.200 |

The old overall 280-record distribution remains a description of the base catalogue only. The table above describes the current CSV.

## Outlet counts and interpretation

The source outlet table contains Fresh 80, Style 25 and Tech 15 outlets. More outlets can sell the same products, so these counts do not determine distinct product counts. No requirement that Fresh have the largest catalogue has been imposed.

Many product catalogues and allocations can reproduce the aggregate observations. This catalogue is not unique or proven minimal. Real product identities and temperature properties require an actual product master or known order line items.

A separate historical exact construction used 96,872 order-average candidates with rational attributes. It demonstrated an exact mathematical solution, not a practical true catalogue or a lower bound. It has not been temperature-split here and is not included in these two CSVs.

## Verification code

Run with the current CSVs and original ZIP in one directory. Requires Python, pandas and numpy.

```python
import zipfile
import pandas as pd
import numpy as np

products = pd.read_csv("products.csv")
lines = pd.read_csv("order_products.csv")
with zipfile.ZipFile("drive-download-20260926T041925Z-1-001(5).zip") as z:
    orders = pd.concat([
        pd.read_csv(z.open("data/Training Data/deliveries_train.csv")),
        pd.read_csv(z.open("data/Test Data/task1_test_inputs.csv")),
    ]).set_index("delivery_id").sort_index()

assert products.product_id.is_unique
assert orders.index.is_unique
assert set(lines.order_id) == set(orders.index)
assert set(lines.product_id) == set(products.product_id)
assert (lines.quantity > 0).all() and (lines.quantity % 1 == 0).all()
assert not lines.duplicated(["order_id", "product_id"]).any()
joined = lines.merge(products, on="product_id", validate="many_to_one")
assert (joined.brand == joined.order_id.map(orders.brand)).all()
assert (joined.temp_requirement == joined.order_id.map(orders.temp_requirement)).all()
assert joined.groupby("order_id").temp_requirement.nunique().eq(1).all()
joined["weight"] = joined.quantity * joined.unit_weight_kg
joined["volume"] = joined.quantity * joined.unit_volume_m3
rebuilt = joined.groupby("order_id")[["quantity", "weight", "volume"]].sum().reindex(orders.index)
assert np.array_equal(rebuilt.quantity, orders.order_units)
assert (abs(rebuilt.weight / orders.order_weight_kg - 1) <= .01 + 1e-9).all()
assert (abs(rebuilt.volume / orders.order_volume_m3 - 1) <= .01 + 1e-9).all()
print("Validated", len(products), "temperature-specific candidates and", len(orders), "orders")
```

The earlier results ZIP and its scripts describe the original fitting stages. Use these updated CSVs and this README for temperature-aware assignments. They preserve the existing numerical fit through deterministic relabelling; they do not claim a new statistical discovery of product temperature.
