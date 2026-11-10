import assert from "node:assert/strict";
import {
  getCurrentTimeSlot,
  getAllTimeSlots,
  isTradingPermittedNow,
  isSymbolPermittedInSlot
} from "./lib/autonomous/timeslots.js";
import { DEFAULT_AUTONOMOUS_CONFIG } from "./lib/autonomous/store.js";

console.log("=====================================================================");
console.log("TEST SUITE: Overlapping Session Hierarchy & Session Deletion Engine");
console.log("=====================================================================\n");

const helperEetTime = (h, m) => h * 3600 + m * 60;

// -------------------------------------------------------------
// TEST 1: Overlapping Session: Disabling NY Silver Bullet does NOT block NY AM
// -------------------------------------------------------------
// 17:30 EET is inside NY Silver Bullet (17:00-18:00) AND NY AM Killzone (16:25-20:30)
const testConfig = {
  ...DEFAULT_AUTONOMOUS_CONFIG,
  allowedTimeSlots: {
    ...DEFAULT_AUTONOMOUS_CONFIG.allowedTimeSlots,
    ny_silver_bullet: false, // User disabled Silver Bullet!
    ny_open: true,           // User kept NY AM enabled
  },
  deletedTimeSlots: [],
};

const slotAt1730 = getCurrentTimeSlot(helperEetTime(17, 30), testConfig);
assert.equal(slotAt1730.id, "ny_open", "When ny_silver_bullet is disabled, 17:30 EET must resolve to ny_open");
assert.equal(slotAt1730.name, "New York Session / AM Killzone (NYKZ)", "Active slot is New York AM Killzone");
console.log("✅ PASS: Disabling ny_silver_bullet dynamically yields enclosing ny_open (New York AM Killzone)");

// -------------------------------------------------------------
// TEST 2: Trading Permission at 17:30 with ny_silver_bullet disabled
// -------------------------------------------------------------
const permit1730 = isTradingPermittedNow(helperEetTime(17, 30), testConfig, "NAS100");
assert.equal(permit1730.permitted, true, "Trading must be PERMITTED for NAS100 at 17:30 under active ny_open");
assert.equal(permit1730.slot.id, "ny_open", "Permitted under ny_open");
console.log("✅ PASS: NAS100 trading permitted at 17:30 EET under ny_open even with ny_silver_bullet toggled off");

// -------------------------------------------------------------
// TEST 3: Overlapping Session: Disabling London Close (18:00-20:00) does NOT block NY AM (16:25-20:30)
// -------------------------------------------------------------
const testConfigLondonCloseDisabled = {
  ...DEFAULT_AUTONOMOUS_CONFIG,
  allowedTimeSlots: {
    ...DEFAULT_AUTONOMOUS_CONFIG.allowedTimeSlots,
    london_close: false, // User disabled London Close!
    ny_open: true,       // Enclosing NY AM is enabled
  },
  deletedTimeSlots: [],
};

const slotAt1845 = getCurrentTimeSlot(helperEetTime(18, 45), testConfigLondonCloseDisabled);
assert.equal(slotAt1845.id, "ny_open", "18:45 EET resolves to ny_open when london_close is disabled");
const permit1845 = isTradingPermittedNow(helperEetTime(18, 45), testConfigLondonCloseDisabled, "NAS100");
assert.equal(permit1845.permitted, true, "Trading permitted at 18:45 EET under ny_open");
console.log("✅ PASS: Disabling london_close allows trading under active ny_open");

// -------------------------------------------------------------
// TEST 4: Both Overlapping Sessions Disabled -> Trading Blocked
// -------------------------------------------------------------
const testConfigBothDisabled = {
  ...DEFAULT_AUTONOMOUS_CONFIG,
  allowedTimeSlots: {
    ...DEFAULT_AUTONOMOUS_CONFIG.allowedTimeSlots,
    ny_silver_bullet: false,
    ny_open: false,
  },
  deletedTimeSlots: [],
};

const permitBothDisabled = isTradingPermittedNow(helperEetTime(17, 30), testConfigBothDisabled, "NAS100");
assert.equal(permitBothDisabled.permitted, false, "Trading blocked when all overlapping sessions disabled");
assert.equal(permitBothDisabled.isUserSlotDisabled, true, "Veto reason indicates user disabled slot");
console.log("✅ PASS: Trading blocked cleanly when all candidate overlapping sessions are disabled");

// -------------------------------------------------------------
// TEST 5: Session Deletion Engine
// -------------------------------------------------------------
const testConfigDeletedSlot = {
  ...DEFAULT_AUTONOMOUS_CONFIG,
  deletedTimeSlots: ["ny_silver_bullet"],
};

const allSlots = getAllTimeSlots(testConfigDeletedSlot);
assert.ok(!allSlots.some(s => s.id === "ny_silver_bullet"), "Deleted session must NOT exist in getAllTimeSlots");
const slotAfterDelete = getCurrentTimeSlot(helperEetTime(17, 30), testConfigDeletedSlot);
assert.equal(slotAfterDelete.id, "ny_open", "17:30 EET resolves to ny_open when ny_silver_bullet is deleted");
const isDeletedPermitted = isSymbolPermittedInSlot("NAS100", "ny_silver_bullet", testConfigDeletedSlot);
assert.equal(isDeletedPermitted, false, "Deleted slot is rejected in symbol session gating");
console.log("✅ PASS: Deleted session successfully omitted from time slots and resolution hierarchy");

console.log("\n=====================================================================");
console.log("🎯 ALL OVERLAPPING SESSION & DELETION TESTS PASSED (100%)");
console.log("=====================================================================\n");
