import type { DayPlanRoutineItem } from "@/types";

/*
 * A starting routine for the office boy, taken from the Office Boy job description (2026-11-26). HR adjusts the
 * order, lengths and checklists before saving; the lengths here are a first guess, not measured.
 */

const cabin = [
  "Clean the floor by vacuuming", "Wipe and clean the tables", "Arrange the tables neatly", "Arrange the chairs properly",
  "Empty the dustbin and keep the area tidy",
];
const glass = "Clean the glass door and remove marks and fingerprints";
const glassW = "Clean the glass door and windows and remove marks and fingerprints";
const pcs = "Dust computers, systems and devices with a soft dry cloth";
const tv = "Clean the TV screen gently with a soft dry cloth";
const cup = "Wipe and dust the cupboards";
const t = (title: string, mins: number, steps: string[], extra: Partial<DayPlanRoutineItem> = {}): DayPlanRoutineItem => ({ title, mins, steps, kind: "task", fixedAt: null, ...extra });

export const OFFICE_BOY_ROUTINE: DayPlanRoutineItem[] = [
  t("Open up", 10, ["Turn on the lights", "Turn on the air conditioners"], { fixedAt: "09:00" }),
  t("Reception", 30, ["Clean the floor by vacuuming", "Clean the steps", "Arrange the chairs properly", "Empty the waste bin and change the garbage bag", "Dust the couches and chairs", "Wipe and clean the reception table", "Clean the glasses and remove fingerprints"]),
  t("Hall Area (GF)", 20, ["Clean the floor by vacuuming", "Clean the steps", tv, "Dust furniture, surfaces and other items"]),
  t("Accounts Cabin", 25, ["Clean the floor by vacuuming", "Wipe and clean the tables and chairs", "Arrange the tables neatly", "Arrange the chairs properly", "Empty the dustbin and keep the area tidy", glass, pcs]),
  t("Minhath Cabin", 20, [...cabin, glass]),
  t("Mentors Cabin", 25, [...cabin, glassW, pcs, tv]),
  t("Hall Area (FF)", 15, ["Clean the floor by vacuuming", "Clean the doors and remove marks and dust"]),
  t("Meeting Pods", 15, ["Clean the inside of the meeting pods", "Arrange the tables neatly", glass]),
  t("Sales Cabin", 25, [...cabin, glassW, pcs, tv]),
  t("Sales Manager Cabin", 15, [...cabin, glass]),
  t("Pantry", 25, [...cabin, "Arrange the tea area neatly", "Clean the tea area and keep it hygienic"]),
  t("Lunch", 30, [], { fixedAt: "13:00", kind: "break" }),
  t("DRAW Cabin", 25, [...cabin, glassW, pcs, tv]),
  t("DRAW Manager Cabin", 15, [...cabin, glassW]),
  t("CAO and HR Cabin", 25, [...cabin, glassW, pcs, cup]),
  t("MD Cabin and Room", 30, [...cabin, glass, pcs, cup, "Clean the curtains"]),
  t("Balcony", 10, ["Remove dust and keep the balcony clean", "Empty and clean the ashtray"]),
  t("Classrooms", 40, ["Clean the floor by vacuuming", "Clean the steps", ...cabin.slice(1), glass, pcs, cup, "Check cables, plugs and switches; report any issues"]),
  t("CSE Cabin", 20, [...cabin, glass, pcs]),
  t("Legal Cabin", 15, [...cabin, glass]),
  t("Ballroom", 20, [...cabin, "Clean the screen gently with a soft dry cloth", "Dust the devices with a soft dry cloth"]),
  t("Washrooms", 20, ["Check every washroom after cleaning", "Restock tissue boxes and cleaning liquids"]),
  t("Garden and outdoor", 20, ["Garden: dust, clean the sofas, clear the ashtrays, arrange tables and chairs", "Check outdoor cleaning and the car porch"]),
  t("Restock and staff check", 15, ["Restock tissues and other supplies as needed", "Check the cleaning staff's work", "Clean the water purifiers"]),
  t("Close up", 15, ["Check systems are turned off; tell the Business Administrator if not", "Turn off the lights", "Turn off the air conditioners"], { fixedAt: "18:00" }),
];
