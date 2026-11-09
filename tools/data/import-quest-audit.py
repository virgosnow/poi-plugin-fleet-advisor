"""Import reviewed quest expressions, without raw wiki pages or player data."""
import argparse
import hashlib
import json
import re
import unicodedata
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
    parser.add_argument("--output", type=Path, default=ROOT / "data/quests/requirements.json")
    parser.add_argument("--practice-review", type=Path, help="Previously reviewed practice definitions to migrate")
    parser.add_argument("--accept-practice-change", action="append", default=[], metavar="P_ID", help="Accept a manually reviewed update for one practice quest; repeat for multiple quests")
    args = parser.parse_args()
    source_file = args.audit_directory / "converted-quests-v8.json"
    quests = json.loads(source_file.read_text(encoding="utf-8"))
    manifest_file = args.audit_directory / "download-manifest.json"
    manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
    destination = args.output
    previous_file = ROOT / "data/quests/requirements.json"
    previous = json.loads(previous_file.read_text(encoding="utf-8")) if previous_file.exists() else {}
    previous_by_code = {row["code"]: row for row in previous.get("quests", [])}
    same_audit = previous.get("source", {}).get("auditSha256") == hashlib.sha256(source_file.read_bytes()).hexdigest()
    reviewed = {number: row for row in previous.get("quests", []) if row.get("category") == "C" for number in row.get("ids", [])}
    if args.practice_review:
        reviewed = {row["id"]: row for row in json.loads(args.practice_review.read_text(encoding="utf-8"))}
    rows = []
    practice_ids = set()
    retained_practice = []
    for quest in quests:
        if quest["category"] not in ("B", "C", "D"):
            continue
        if same_audit and quest["category"] in ("B", "D") and quest["code"] in previous_by_code:
            rows.append(previous_by_code[quest["code"]])
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
        if quest["category"] == "C":
            if len(row["ids"]) != 1 or not quest.get("fleet") or not quest.get("goals"):
                raise ValueError(f"Practice quest requires one verified game ID, fleet and goals: {quest['code']}")
            number = row["ids"][0]
            if number in practice_ids:
                raise ValueError(f"Duplicate practice game ID {number}")
            practice_ids.add(number)
            row["wikiCode"] = row["code"]
            row["code"] = f"P{number}"
            row["period"] = {"单次":"once", "日常":"daily", "周常":"weekly", "月常":"monthly", "季常":"quarterly", "年常":"yearly"}.get(row["period"], row["period"])
        if quest["code"] == "Bm7":
            # The audit preserves an unresolved 266/267 source disagreement.
            # Neither numeric ID alone is sufficient to identify this quest.
            row["ids"] = [266, 267]
            row["requireTitleMatch"] = True
        row.update(fleet=compact(quest["fleet"]), goals=compact(quest["goals"]), source=source)
        if quest["category"] == "C" and number in reviewed:
            old = reviewed[number]
            title_key = lambda value: re.sub(r"\s+", "", unicodedata.normalize("NFKC", str(value or "")))
            if old.get("title") and title_key(old["title"]) != title_key(row["title"]) and row["code"] not in args.accept_practice_change:
                raise ValueError(f"Practice quest {number} changed title; review its identity before accepting it")
        if quest["category"] == "C" and number in reviewed and row["code"] not in args.accept_practice_change:
            old = reviewed[number]
            retained_practice.append(row["code"])
            row["fleet"] = old["fleet"]
            if "goals" in old:
                row["goals"] = old["goals"]
            else:
                match = re.fullmatch(r"(?:本日|本周)演习(.*?) (\d+)次", old["goal"])
                if not match:
                    raise ValueError(f"Unrecognized reviewed practice goal: {old['goal']}")
                rank = {"":"any", "胜利":"win", "A胜以上":"A", "S胜":"S"}[match.group(1)]
                row["goals"] = [{"kind":"practice", "count":int(match.group(2)), "rankMin":rank,
                                 "withinDay":number not in (301, 302)}]
            row["period"] = old["period"]
            if old.get("requireTitleMatch"):
                row["requireTitleMatch"] = True
        model = quest.get("stateModel", {})
        for key in ("claimResources", "recommendationActionResources"):
            if model.get(key):
                row[key] = model[key]
        if quest.get("completionChecks"):
            row["completionChecks"] = [{"kind": item["kind"]} for item in quest["completionChecks"]]
        if model.get("acceptanceInitialization"):
            row["acceptanceInitialization"] = model["acceptanceInitialization"]
        rows.append(row)
    # Seasonal task IDs are reused. Retain reviewed, title-guarded entries
    # when the permanent audit does not enumerate the seasonal tables.
    for number, old in reviewed.items():
        if number in practice_ids:
            continue
        if old.get("period") != "limited" or not old.get("requireTitleMatch"):
            raise ValueError(f"Audit omitted previously reviewed practice quest {number}; refusing to discard it")
        if "goals" in old:
            rows.append(old)
        else:
            rows.append({"code":f"P{number}", "category":"C", "period":"limited", "title":old["title"],
                         "ids":[number], "requireTitleMatch":True, "fleet":old["fleet"],
                         "goals":[{"kind":"practice", "count":8, "rankMin":"win", "withinDay":True}],
                         "source":{"url":"https://wikiwiki.jp/kancolle/任務/演習任務"}})
    unknown_accepted = set(args.accept_practice_change) - {f"P{number}" for number in practice_ids}
    if unknown_accepted:
        raise ValueError(f"Unknown reviewed practice codes: {', '.join(sorted(unknown_accepted))}")
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
            "scope": "Reviewed sortie, practice and expedition quests; only server-listed available/active quests are displayed.",
            "rights": "Original wiki wording and game names retain their original rights; structured rules are independently implemented. Raw pages are not distributed.",
            "sources": [{key: item[key] for key in ("page", "url", "sha256")} for item in manifest],
            "boundaries": [
                "Rules are reviewed sufficient-action definitions, not proof of every minimal game requirement.",
                "Goal counts are requirements, never inferred remaining counts or server progress.",
                "No prerequisite inference or task acceptance; seasonal tasks require a matching live title.",
                "Ordinary same-name remodels are accepted; renamed or type-converted forms require explicit permission or remain unknown."
            ]
        },
        "enemyTargets": enemy_targets,
        "quests": rows
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Imported {len(rows)} quests: {destination.stat().st_size} bytes")
    if retained_practice:
        print(f"Retained {len(retained_practice)} previously reviewed practice rules; use --accept-practice-change P_ID after reviewing an update.")


if __name__ == "__main__":
    main()
