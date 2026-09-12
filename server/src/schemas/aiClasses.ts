import { TableSchema } from "./types";

/**
 * ai.tbl / *-aic.tbm schema - base AI skill-level class definitions (Trainee, Rookie,
 * Veteran, ...), distinct from the tunable ai_profiles.tbl.
 *
 * Modular suffix confirmed as `-aic.tbm`, NOT `-ai.tbm` (an earlier guess) - live-verified
 * against `code/ai/aicode.cpp`'s `ai_init()`: `parse_modular_table("*-aic.tbm",
 * parse_aitbl)`. The wrong suffix meant listMatchingFiles() would never find a single
 * real ai.tbl .tbm across any real mod, silently merging nothing.
 *
 * fieldOrder below is a mechanical, in-source-order extraction of every `$Field:`
 * literal read by `parse_ai_class()` (aicode.cpp:732-950), replacing an earlier
 * best-effort guess that only covered `Accuracy`/`Evasion`/`Courage`/`Patience` - a real
 * Blue Planet ai.tbl flagged 270 diagnostics under `unknownFieldSeverity` before this
 * expansion. The many boolean flag fields at the end (`smart primary weapon
 * selection`, `allow vertical dodge`, etc., set via the shared `set_aic_flag()` helper)
 * are included in their real call order too, even though this project doesn't
 * currently do anything special with them beyond order-checking.
 */
export const aiClassesSchema: TableSchema = {
  name: "ai.tbl",
  fileMatch: [/(^|[\\/])ai\.tbl$/i, /-aic\.tbm$/i],
  sectionNames: ["AI Classes"],
  entryKeyField: "Name",
  fieldOrder: [
    "Name",
    "accuracy",
    "evasion",
    "courage",
    "patience",
    "Afterburner Use Factor",
    "Shockwave Evade Chances Per Second",
    "Get Away Chance",
    "Secondary Range Multiplier",
    "Autoscale by AI Class Index",
    "AI Countermeasure Firing Chance",
    "AI In Range Time",
    "AI Always Links Ammo Weapons",
    "AI Maybe Links Ammo Weapons",
    "Primary Ammo Burst Multiplier",
    "AI Always Links Energy Weapons",
    "AI Maybe Links Energy Weapons",
    "Predict Position Delay",
    "AI Shield Manage Delay",
    "AI Shield Manage Delays",
    "Friendly AI Fire Delay Scale",
    "Hostile AI Fire Delay Scale",
    "Friendly AI Secondary Fire Delay Scale",
    "Hostile AI Secondary Fire Delay Scale",
    "AI Turn Time Scale",
    "Glide Attack Percent",
    "Circle Strafe Percent",
    "Glide Strafe Percent",
    "Random Sidethrust Percent",
    "Stalemate Time Threshold",
    "Stalemate Distance Threshold",
    "Chance AI Has to Fire Missiles at Player",
    "Max Aim Update Delay",
    "Turret Max Aim Update Delay",
    "big ships can attack beam turrets on untargeted ships",
    "smart primary weapon selection",
    "smart secondary weapon selection",
    "smart shield management",
    "smart afterburner management",
    "free afterburner use",
    "allow rapid secondary dumbfire",
    "huge turret weapons ignore bombs",
    "don't insert random turret fire delay",
    "prevent turrets targeting too distant bombs",
    "smart subsystem targeting for turrets",
    "allow turrets target weapons freely",
    "allow vertical dodge",
    "no extra collision avoidance vs player",
    "all ships manage shields",
    "ai can slow down when attacking big ships",
    "use actual primary range",
    "firing requires exact los",
    "AI balances shields instead of directs when attacked",
  ],
};
