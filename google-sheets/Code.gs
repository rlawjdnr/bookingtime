const SHEETS = {
  calendar: "예약 캘린더",
  reservations: "예약현황",
  timeBlocks: "시간블록",
  waitRules: "대기시간규칙",
  clinic: "병원설정",
  logs: "동기화로그",
};

const BOOKING_SPREADSHEET_ID = "1zcmCfbGr-mEmr8XBynYEdPGO5UzfOklM-nr4NqqIWUg";
const STATUS_TO_DB = {
  "예약 완료": "confirmed",
  "예약 취소": "cancelled",
};

const STATUS_TO_SHEET = {
  confirmed: "예약 완료",
  cancelled: "예약 취소",
};

const RESERVATION_HEADER_ROW = 3;
const RESERVATION_DATA_START_ROW = 4;
const RESERVATION_COLUMN_COUNT = 12;
const RESERVATION_DATE_FILTER_CELL = "B1";

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    const payload = body.payload || {};

    if (body.action === "create") upsertReservationFromApp_(payload);
    if (body.action === "cancel") cancelReservationFromApp_(payload);

    setupReservationCalendar();
    logSync_("예약 페이지", body.action || "unknown", "성공", payload.id || "");
    return json_({ ok: true });
  } catch (error) {
    logSync_("예약 페이지", "webhook", "실패", error.message);
    return json_({ ok: false, error: error.message });
  }
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const name = sheet.getName();
  const row = e.range.getRow();
  const column = e.range.getColumn();

  try {
    if (name === SHEETS.reservations) {
      setupReservationStatusView_(sheet);
      if (row === 1 && column === 2) {
        applyReservationDateFilter_(sheet);
        return;
      }
      if (row < RESERVATION_DATA_START_ROW) return;
      syncReservationRowToSupabase_(sheet, row);
    }
    if (row < 2) return;
    if (name === SHEETS.timeBlocks) syncTimeBlockRowToSupabase_(sheet, row);
    if (name === SHEETS.waitRules) syncWaitRuleRowToSupabase_(sheet, row);
    if (name === SHEETS.clinic) syncClinicSettingsToSupabase_();

    if ([SHEETS.reservations, SHEETS.timeBlocks, SHEETS.waitRules, SHEETS.clinic].includes(name)) {
      setupReservationCalendar();
    }
  } catch (error) {
    logSync_("관리자 시트", name, "실패", error.message);
    SpreadsheetApp.getActive().toast(error.message, "동기화 실패", 5);
  }
}

function upsertReservationFromApp_(booking) {
  const sheet = getSheet_(SHEETS.reservations);
  setupReservationStatusView_(sheet);
  const id = String(booking.id || "");
  if (!id) throw new Error("예약 ID가 없어서 시트에 저장하지 못했어요.");

  const foundRow = findRowByValue_(sheet, 11, id);
  const now = new Date();
  const values = [
    makeReservationNo_(id),
    STATUS_TO_SHEET[booking.status] || "예약 완료",
    booking.patientName || "",
    booking.date || "",
    booking.time || "",
    booking.treatment || "없음",
    Number(booking.waitMinutes || 15),
    now,
    "",
    "예약 페이지",
    id,
    "",
  ];

  const targetRow = foundRow || Math.max(sheet.getLastRow() + 1, RESERVATION_DATA_START_ROW);
  sheet.getRange(targetRow, 4).setNumberFormat("@");
  sheet.getRange(targetRow, 5).setNumberFormat("@");
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  applyReservationDateFilter_(sheet);
}

function cancelReservationFromApp_(booking) {
  const sheet = getSheet_(SHEETS.reservations);
  setupReservationStatusView_(sheet);
  const id = String(booking.id || "");
  const row = findRowByValue_(sheet, 11, id);
  if (!row) {
    upsertReservationFromApp_(Object.assign({}, booking, { status: "cancelled" }));
    return;
  }

  sheet.getRange(row, 2).setValue("예약 취소");
  sheet.getRange(row, 9).setValue(new Date());
  sheet.getRange(row, 12).setValue(booking.cancelReason || "");
  applyReservationDateFilter_(sheet);
}

function syncReservationRowToSupabase_(sheet, row) {
  setupReservationStatusView_(sheet);
  const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
  const patientName = String(values[2] || "").trim();
  const appointmentDate = toDateKey_(values[3]);
  const appointmentTime = toTimeLabel_(values[4]);
  if (!patientName || !appointmentDate || !appointmentTime) return;

  const id = String(values[10] || Utilities.getUuid());
  const status = STATUS_TO_DB[String(values[1] || "예약 완료")] || "confirmed";
  const reservation = {
    id,
    patient_name: patientName,
    appointment_date: appointmentDate,
    appointment_time: appointmentTime,
    treatment: String(values[5] || "없음"),
    wait_minutes: Number(values[6] || 15),
    status,
    cancel_reason: status === "cancelled" ? String(values[11] || "") : null,
    updated_at: new Date().toISOString(),
  };

  supabaseRequest_("reservations?id=eq." + encodeURIComponent(id), "PATCH", reservation, { prefer: "return=minimal" });
  if (!values[10]) {
    supabaseRequest_("reservations", "POST", reservation, { prefer: "resolution=merge-duplicates,return=minimal" });
    sheet.getRange(row, 1).setValue(makeReservationNo_(id));
    sheet.getRange(row, 8).setValue(new Date());
    sheet.getRange(row, 10).setValue("관리자 시트");
    sheet.getRange(row, 11).setValue(id);
  }
  logSync_("관리자 시트", "예약현황", "성공", id);
  applyReservationDateFilter_(sheet);
}

function syncTimeBlockRowToSupabase_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 7).getValues()[0];
  const timeLabel = String(values[2] || "").trim();
  if (!timeLabel) return;

  const id = String(values[0] || timeLabel.replace(":", "").padStart(4, "0"));
  const block = {
    id,
    time_label: timeLabel,
    capacity: Number(values[3] || 0),
    is_open: String(values[4] || "예약 가능") === "예약 가능",
    sort_order: Number(values[5] || row * 10),
    updated_at: new Date().toISOString(),
  };

  supabaseRequest_("appointment_time_blocks", "POST", block, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  sheet.getRange(row, 1).setValue(id);
  logSync_("관리자 시트", "시간블록", "성공", id);
}

function syncWaitRuleRowToSupabase_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 5).getValues()[0];
  const timeBlockId = String(values[1] || "").trim();
  const reservationOrder = Number(values[2] || 0);
  if (!timeBlockId || !reservationOrder) return;

  const id = String(values[0] || Utilities.getUuid());
  const rule = {
    id,
    time_block_id: timeBlockId,
    reservation_order: reservationOrder,
    wait_minutes: Number(values[3] || 15),
  };

  supabaseRequest_("wait_time_rules", "POST", rule, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  sheet.getRange(row, 1).setValue(id);
  logSync_("관리자 시트", "대기시간규칙", "성공", id);
}

function syncClinicSettingsToSupabase_() {
  const sheet = getSheet_(SHEETS.clinic);
  const values = sheet.getRange("A1:B12").getValues();
  const map = {};
  values.forEach(([label, value]) => {
    map[String(label || "").trim()] = value;
  });

  const settings = {
    id: "default",
    clinic_name: String(map["병원 이름"] || "이목구비 김한의원"),
    phone: String(map["전화번호"] || "055-335-9799"),
    open_days: Number(map["예약 오픈 기간(일)"] || 7),
    updated_at: new Date().toISOString(),
  };

  supabaseRequest_("clinic_settings", "POST", settings, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  logSync_("관리자 시트", "병원설정", "성공", settings.clinic_name);
}

function setupReservationCalendar() {
  const ss = getSpreadsheet_();
  const calendarSheet = ss.getSheetByName(SHEETS.calendar);
  if (calendarSheet && ss.getSheets().length > 1) calendarSheet.hideSheet();

  const sheet = getSheet_(SHEETS.reservations);
  setupReservationStatusView_(sheet);
  applyReservationDateFilter_(sheet);
}

function setupBookingSheetAdmin() {
  setupReservationCalendar();
  getSpreadsheet_().toast("예약현황에 날짜 선택 필터를 만들었어요.", "설정 완료", 5);
}

function onSelectionChange(e) {
  return;
}

function setupReservationStatusView_(sheet) {
  const existingFilter = sheet.getFilter();
  if (existingFilter) existingFilter.remove();

  const firstCell = String(sheet.getRange("A1").getValue() || "").trim();
  if (firstCell !== "조회 날짜") {
    sheet.insertRowsBefore(1, 2);
  }

  const filterCell = sheet.getRange(RESERVATION_DATE_FILTER_CELL);
  if (!filterCell.getValue()) filterCell.setValue(new Date());

  sheet.getRange("A1").setValue("조회 날짜").setFontWeight("bold").setBackground("#F1F3F5");
  filterCell
    .setNumberFormat("yyyy-mm-dd")
    .setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build())
    .setNote("보고 싶은 예약 날짜를 선택하면 아래 목록이 그 날짜 예약만 시간순으로 보여요.");
  sheet.getRange("A2:L2").breakApart();
  sheet.getRange("A2:L2").merge().setValue("선택한 날짜의 예약만 표시됩니다. 전체 목록을 보려면 필터를 해제하거나 조회 날짜를 바꿔주세요.").setFontColor("#5F6368");
  sheet.getRange(RESERVATION_HEADER_ROW, 1, 1, RESERVATION_COLUMN_COUNT)
    .setValues([["예약번호", "예약 상태", "환자 이름", "예약 날짜", "예약 시간", "진료 항목", "대기 시간(분)", "예약 접수 시간", "예약 취소 시간", "입력 위치", "예약 ID", "취소 사유"]])
    .setFontWeight("bold")
    .setBackground("#E9ECEF");
  sheet.setFrozenRows(RESERVATION_HEADER_ROW);
  sheet.getRange(RESERVATION_DATA_START_ROW, 4, Math.max(sheet.getMaxRows() - RESERVATION_DATA_START_ROW + 1, 1), 1).setNumberFormat("@");
  sheet.getRange(RESERVATION_DATA_START_ROW, 5, Math.max(sheet.getMaxRows() - RESERVATION_DATA_START_ROW + 1, 1), 1).setNumberFormat("@");
}

function applyReservationDateFilter_(sheet) {
  const selectedDateKey = toDateKey_(sheet.getRange(RESERVATION_DATE_FILTER_CELL).getValue() || new Date());
  const lastRow = Math.max(sheet.getLastRow(), RESERVATION_DATA_START_ROW);

  if (lastRow >= RESERVATION_DATA_START_ROW) {
    const dateRange = sheet.getRange(RESERVATION_DATA_START_ROW, 4, lastRow - RESERVATION_DATA_START_ROW + 1, 1);
    const normalizedDates = dateRange.getValues().map(([value]) => [toDateKey_(value)]);
    dateRange.setNumberFormat("@").setValues(normalizedDates);
  }

  const previousFilter = sheet.getFilter();
  if (previousFilter) previousFilter.remove();

  const filterRange = sheet.getRange(RESERVATION_HEADER_ROW, 1, lastRow - RESERVATION_HEADER_ROW + 1, RESERVATION_COLUMN_COUNT);
  const filter = filterRange.createFilter();
  filter.setColumnFilterCriteria(4, SpreadsheetApp.newFilterCriteria().whenTextEqualTo(selectedDateKey).build());
  filter.sort(5, true);
}

function getReservationCountsByDate_(sheet) {
  const values = sheet.getDataRange().getValues().slice(1);
  const counts = {};
  values.forEach((row) => {
    if (String(row[1]) !== "예약 완료") return;
    const key = toDateKey_(row[3]);
    if (!key) return;
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function renderSelectedDateReservations_(calendarSheet, reservationSheet, selectedDate) {
  const key = toDateKey_(selectedDate);
  const rows = reservationSheet
    .getDataRange()
    .getValues()
    .slice(1)
    .filter((row) => toDateKey_(row[3]) === key)
    .sort((a, b) => String(a[4]).localeCompare(String(b[4])));

  calendarSheet.getRange("I4:L4").setValues([["시간", "환자 이름", "진료 항목", "상태"]]).setFontWeight("bold");
  if (!rows.length) {
    calendarSheet.getRange("I5:L5").merge().setValue("이 날짜에는 예약이 없어요.");
    return;
  }

  calendarSheet.getRange(5, 9, rows.length, 4).setValues(rows.map((row) => [row[4], row[2], row[5], row[1]]));
}

function supabaseRequest_(path, method, payload, options) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = props.getProperty("SUPABASE_URL") || "https://ohwvtwywwjbwlkknwjxe.supabase.co";
  const anonKey = props.getProperty("SUPABASE_ANON_KEY");
  if (!anonKey) throw new Error("Apps Script 설정에 SUPABASE_ANON_KEY를 추가해주세요.");

  const response = UrlFetchApp.fetch(`${baseUrl}/rest/v1/${path}`, {
    method,
    contentType: "application/json",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      Prefer: (options && options.prefer) || "return=minimal",
    },
    payload: payload ? JSON.stringify(payload) : undefined,
    muteHttpExceptions: true,
  });

  const code = response.getResponseCode();
  if (code >= 300) throw new Error(response.getContentText());
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

function getSheet_(name) {
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error(`${name} 시트를 찾지 못했어요.`);
  return sheet;
}

function getSpreadsheet_() {
  if (typeof SPREADSHEET_ID !== "undefined") return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.openById(BOOKING_SPREADSHEET_ID);
}

function findRowByValue_(sheet, column, value) {
  if (!value) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < RESERVATION_DATA_START_ROW) return 0;
  const values = sheet.getRange(RESERVATION_DATA_START_ROW, column, lastRow - RESERVATION_DATA_START_ROW + 1, 1).getValues();
  const index = values.findIndex((row) => String(row[0]) === String(value));
  return index >= 0 ? index + RESERVATION_DATA_START_ROW : 0;
}

function makeReservationNo_(id) {
  return `R-${String(id).slice(0, 8).toUpperCase()}`;
}

function toDate_(value) {
  if (value instanceof Date) return value;
  return new Date(value);
}

function toDateKey_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function toTimeLabel_(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const hour = value.getHours();
    const minute = value.getMinutes();
    return minute ? `${hour}:${String(minute).padStart(2, "0")}` : `${hour}:00`;
  }
  return String(value).trim();
}

function cleanupIntegrationTestRows() {
  const sheet = getSheet_(SHEETS.reservations);
  for (let row = sheet.getLastRow(); row >= 2; row -= 1) {
    const patientName = String(sheet.getRange(row, 3).getValue()).trim();
    if (patientName === "연동테스트" || patientName === "속도테스트") {
      sheet.deleteRow(row);
    }
  }
  if (typeof setupReservationCalendar === "function") setupReservationCalendar();
}

function logSync_(source, action, status, detail) {
  const sheet = getSpreadsheet_().getSheetByName(SHEETS.logs);
  if (!sheet) return;
  sheet.appendRow([new Date(), source, action, status, detail]);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function setupSupabaseSyncTriggers() {
  const spreadsheetId = typeof SPREADSHEET_ID !== "undefined" ? SPREADSHEET_ID : BOOKING_SPREADSHEET_ID;
  const triggers = ScriptApp.getProjectTriggers();
  const hasEditTrigger = triggers.some((trigger) => trigger.getHandlerFunction() === "onEdit");

  if (!hasEditTrigger) {
    ScriptApp.newTrigger("onEdit").forSpreadsheet(spreadsheetId).onEdit().create();
  }

  getSpreadsheet_().toast("구글 시트와 Supabase 실시간 동기화 준비가 끝났어요.", "연결 완료", 5);
}
