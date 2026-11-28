#!/usr/bin/env python3
"""Builds android/app/src/main/assets/catalogue/vehicles.json from the owner-supplied research files.
Usage: python3 -I scripts/build-vehicle-catalogue.py <Indian_EV_Vehicle_Database.json> <nearvolt_ev_vehicle_catalogue_draft.json> android/app/src/main/assets/catalogue docs/catalogue/conflicts.json
Rules: "Not publicly verified" -> null (never guessed). Legacy/proprietary connectors are NOT mapped to an app connector code.
Draft records (PDF extractions of the same 62 configurations) are used only to report conflicts; supplementary guide claims are kept as
printed text, flagged unverified and never used for compatibility or estimates."""
import json, re, sys
db_path, draft_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
db, dr = json.load(open(db_path, encoding="utf-8")), json.load(open(draft_path, encoding="utf-8"))
NV = db.get("unverified_marker", "Not publicly verified")
def val(x):
    if x is None or x == NV or (isinstance(x, str) and x.strip() in ("", NV)): return None
    return x
def num(x):
    x = val(x)
    if isinstance(x, bool): return None
    if isinstance(x, (int, float)): return float(x)
    if isinstance(x, str) and re.fullmatch(r"\s*\d+(\.\d+)?\s*", x): return float(x)
    return None
def code(label):
    l = (val(label) or "").strip().lower()
    return {"type 2": "TYPE2_AC", "ccs2": "CCS2"}.get(l)   # anything else stays unmapped (legacy / verify VIN)
tiers = {t["vehicle_id"]: {k: v for k, v in t.items() if k[:3] in ("AC_", "DC_")} for t in db["power_tier_screening"]}
vehicles, conflicts = [], []
# Draft ids are in a different order from the database ids, so match by normalized model + battery generation text.
def key(model, gen): return (re.sub(r"[^a-z0-9]", "", (model or "").lower()), re.sub(r"[^a-z0-9.]", "", (gen or "").lower()))
draft_by_key, draft_by_model = {}, {}
for r in dr["variant_records"]:
    draft_by_key.setdefault(key(r["model"], r.get("generation_as_printed")), []).append(r)
    draft_by_model.setdefault(key(r["model"], "")[0], []).append(r)
unmatched_draft = {r["draft_id"] for r in dr["variant_records"]}
for v in db["vehicles"]:
    rec = dict(id=v["vehicle_id"], brand=v["brand"], ownership=v.get("ownership_category"), model=v["model"], variant=val(v.get("battery_charging_variant")),
        year=v.get("first_india_release_year") if isinstance(v.get("first_india_release_year"), int) else None,
        status=v.get("market_status_as_of_2026_10_22"), batteryKwh=num(v["battery_capacity_kwh"]),
        acSupported=v["ac_supported"] if isinstance(v["ac_supported"], bool) else None, acMaxKw=num(v["maximum_ac_vehicle_acceptance_kw"]),
        dcSupported=v["dc_supported"] if isinstance(v["dc_supported"], bool) else None, dcMaxKw=num(v["maximum_dc_vehicle_acceptance_kw"]),
        ac0to100h=num(v["ac_0_to_100_hours"]), acWindow=val(v.get("ac_published_charge_window")), dc10to80min=num(v["dc_10_to_80_minutes"]),
        dc0to100h=num(v["dc_0_to_100_hours"]), otherDcWindow=val(v.get("other_verified_dc_charge_window")),
        acConnectorLabel=val(v["ac_connector"]), acConnector=code(v["ac_connector"]), dcConnectorLabel=val(v["dc_connector"]), dcConnector=code(v["dc_connector"]),
        rangeKm=num(v["claimed_range_km"]), rangeStandard=val(v.get("range_test_standard")), batteryEvidence=val(v.get("battery_evidence_level")),
        chargingEvidence=val(v.get("charging_evidence_level")), sourceUrl=val(v.get("source_url")), secondarySourceUrl=val(v.get("secondary_source_url")),
        checkedAt=val(v.get("source_checked_date")), notes=val(v.get("notes")), tierScreening=tiers.get(v["vehicle_id"], {}))
    # Unverified anywhere -> unknown, never "supported": a DC connector without dcSupported=true is not offered.
    if rec["dcSupported"] is not True: rec["dcConnector"] = None
    if rec["acSupported"] is not True: rec["acConnector"] = None
    m = draft_by_key.get(key(v["model"], v.get("battery_charging_variant")), [])
    if not m:   # the PDF extraction truncates long generation text: accept a unique prefix match
        k = key(v["model"], v.get("battery_charging_variant"))
        m = [r for kk, rs in draft_by_key.items() if kk[0] == k[0] and len(kk[1]) >= 12 and k[1].startswith(kk[1]) for r in rs]
    if not m:   # same model, same battery size -> same configuration
        m = [r for r in draft_by_model.get(key(v["model"], "")[0], []) if rec["batteryKwh"] is not None and num(r.get("battery_kwh_reported")) == rec["batteryKwh"]]
    d = m[0] if len(m) == 1 else None
    if d: unmatched_draft.discard(d["draft_id"])
    if d:
        for a, b in (("batteryKwh", "battery_kwh_reported"), ("acMaxKw", "ac_max_kw_reported"), ("dcMaxKw", "dc_max_kw_reported"),
                     ("ac0to100h", "ac_0_100_hours_reported"), ("dc10to80min", "dc_10_80_minutes_reported")):
            x, y = rec[a], num(d.get(b))
            if x is not None and y is not None and abs(x - y) > 1e-6: conflicts.append(dict(id=rec["id"], field=a, database=x, draft=y, kept="database (has source URL)"))
    vehicles.append(rec)
claims = [dict(model=c["model"], batteryAsPrinted=c.get("battery_as_printed"), acAsPrinted=c.get("ac_as_printed"), dcAsPrinted=c.get("dc_as_printed"),
               timeAsPrinted=c.get("time_as_printed"), source="India EV Cars Charging Guide (owner-supplied PDF), page %s" % c["source"]["page"]) for c in dr["supplementary_model_claims"]]
meta = dict(generatedFrom=["Indian_EV_Vehicle_Database.json", "nearvolt_ev_vehicle_catalogue_draft.json"], researchCutoff=db.get("cutoff_date"),
    scope=db.get("data_scope"), caution=db.get("caution"), images="No image rights established for any vehicle; app shows a labelled illustration.",
    counts=dict(configurations=len(vehicles), brands=len({v["brand"] for v in vehicles}), models=len({(v["brand"], v["model"]) for v in vehicles}),
        supplementaryClaims=len(claims), conflicts=len(conflicts), withSourceUrl=sum(1 for v in vehicles if v["sourceUrl"]),
        verifiedAcMaxKw=sum(1 for v in vehicles if v["acMaxKw"] is not None), verifiedDcMaxKw=sum(1 for v in vehicles if v["dcMaxKw"] is not None),
        verifiedDc10to80=sum(1 for v in vehicles if v["dc10to80min"] is not None), verifiedAc0to100=sum(1 for v in vehicles if v["ac0to100h"] is not None)))
json.dump(dict(meta=meta, vehicles=vehicles, supplementaryClaims=claims, sources=db.get("source_registry", {})),
          open(f"{out}/vehicles.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
conflicts.append(dict(unmatchedDraftRecords=sorted(unmatched_draft)))
json.dump(conflicts, open(sys.argv[4] if len(sys.argv) > 4 else f"{out}/conflicts.json", "w", encoding="utf-8"), indent=1)
print(json.dumps(meta["counts"]))
