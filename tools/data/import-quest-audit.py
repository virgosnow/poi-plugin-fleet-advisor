"""Import reviewed quest expressions, without raw wiki pages or player data."""
import argparse
import hashlib
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def compact(value):
    if isinstance(value, list):
        return [compact(item) for item in value]
    if isinstance(value, dict):
        return {key: compact(item) for key, item in value.items()
                if key not in ("evidence", "hasOtherForms", "countHint")}
    return value


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audit_directory", type=Path)
    args = parser.parse_args()
    source_file = args.audit_directory / "converted-quests-v8.json"
    quests = json.loads(source_file.read_text(encoding="utf-8"))
    manifest_file = args.audit_directory / "download-manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    rows = []
    for quest in quests:
        if quest["category"] not in ("B", "D"):
            continue
        source = {"url": quest["url"], "crossCheckUrl": "https://zh.kcwiki.cn/wiki/任务"}
        for key in ("sourceReview", "englishWikiReview", "userRuleReview"):
            review = quest.get(key, {})
            if review.get("decision"):
                source.setdefault("reviews", []).append({"kind": key, "decision": review["decision"]})
            for evidence in review.get("sources", []):
                record = {key: evidence[key] for key in ("url", "sha256", "retrieval") if key in evidence}
                if record not in source.setdefault("evidence", []):
                    source["evidence"].append(record)
        row = {key: quest[key] for key in ("code", "category", "period", "title")}
        row["ids"] = sorted(number for number in set(quest.get("gameIdCandidates", [])) | {quest["wikiGameId"]} if isinstance(number, int))
        if quest["code"] == "Bm7":
            # The audit preserves an unresolved 266/267 source disagreement.
            # Neither numeric ID alone is sufficient to identify this quest.
            row["ids"] = [266, 267]
            row["requireTitleMatch"] = True
        row.update(fleet=compact(quest["fleet"]), goals=compact(quest["goals"]), source=source)
        model = quest.get("stateModel", {})
        for key in ("claimResources", "recommendationActionResources"):
            if model.get(key):
                row[key] = model[key]
        if quest.get("completionChecks"):
            row["completionChecks"] = [{"kind": item["kind"]} for item in quest["completionChecks"]]
        if model.get("acceptanceInitialization"):
            row["acceptanceInitialization"] = model["acceptanceInitialization"]
        rows.append(row)
    ids = {}
    for row in rows:
        for number in row["ids"]:
            ids.setdefault(number, []).append(row)
    for candidates in ids.values():
        if len(candidates) > 1:
            for candidate in candidates:
                candidate["requireTitleMatch"] = True
    enemy_catalog = json.loads((ROOT / "data/sortie/enemy_catalog.json").read_text(encoding="utf-8"))
    enemy_by_id = {entry.get("apiId"): entry for entry in enemy_catalog["enemies"]}
    enemy_targets = {}
    def enemies_in(value):
        if isinstance(value, list):
            for item in value:
                yield from enemies_in(item)
        elif isinstance(value, dict):
            for key, item in value.items():
                if key == "enemyShips":
                    yield from item or []
                else:
                    yield from enemies_in(item)
    for encounter_file in sorted((ROOT / "data/sortie/encounters").glob("*.json")):
        encounter = json.loads(encounter_file.read_text(encoding="utf-8"))
        groups = {"carrier": set(), "submarine": set(), "transport": set()}
        for enemy in enemies_in(encounter.get("nodes", {})):
            entry = enemy_by_id.get(enemy.get("apiId"), {})
            name = enemy.get("name") or entry.get("name", "")
            ship_type = entry.get("shipType", "")
            if "空母" in ship_type or "空母" in name or name.startswith("軽母"):
                groups["carrier"].add(name)
            if "潜水" in ship_type or "潜水" in name:
                groups["submarine"].add(name)
            if "輸送" in ship_type or "補給" in ship_type or name.startswith(("輸送", "補給", "ヒ船団")):
                groups["transport"].add(name)
        enemy_targets[encounter_file.stem] = {key: sorted(names) for key, names in groups.items()}
    result = {
        "schemaVersion": 1,
        "auditedAt": "2026-10-22",
        "source": {
            "auditSha256": hashlib.sha256(source_file.read_bytes()).hexdigest(),
            "scope": "Permanent sortie and expedition quests; only server-listed available/active quests are displayed.",
            "rights": "Original wiki wording and game names retain their original rights; structured rules are independently implemented. Raw pages are not distributed.",
            "sources": [{key: item[key] for key in ("page", "url", "sha256")} for item in manifest],
            "boundaries": [
                "Rules are reviewed sufficient-action definitions, not proof of every minimal game requirement.",
                "Goal counts are requirements, never inferred remaining counts or server progress.",
                "No prerequisite inference, task acceptance, completion tracking or limited-time quests.",
                "Ordinary same-name remodels are accepted; renamed or type-converted forms require explicit permission or remain unknown."
            ]
        },
        "enemyTargets": enemy_targets,
        "quests": rows
    }
    destination = ROOT / "data/quests/requirements.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(rows)} quests: {destination.stat().st_size} bytes")


if __name__ == "__main__":
    main()
