const BT_STATUS_TO_DB = {
  "예약 완료": "confirmed",
  "예약 취소": "cancelled",
};

const BT_STATUS_TO_SHEET = {
  confirmed: "예약 완료",
  cancelled: "예약 취소",
};

function doPost(e) {
  try {
    const body = JSON.parse(e.postData && e.postData.contents ? e.postData.contents : "{}");
    const payload = body.payload || {};

    if (body.action === "create") btUpsertReservationFromApp_(payload);
    if (body.action === "cancel") btCancelReservationFromApp_(payload);

    btRefreshCalendar_();
    btLogSync_("예약 페이지", body.action || "unknown", "성공", payload.id || "");
    return btJson_({ ok: true });
  } catch (error) {
    btLogSync_("예약 페이지", "webhook", "실패", error.message);
    return btJson_({ ok: false, error: error.message });
  }
}

function onEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  const name = sheet.getName();
  const row = e.range.getRow();
  if (row < 2) return;

  try {
    if (name === "예약현황") btSyncReservationRowToSupabase_(sheet, row);
    if (name === "시간블록") btSyncTimeBlockRowToSupabase_(sheet, row);
    if (name === "대기시간규칙") btSyncWaitRuleRowToSupabase_(sheet, row);
    if (name === "병원설정") btSyncClinicSettingsToSupabase_();

    if (["예약현황", "시간블록", "대기시간규칙", "병원설정"].includes(name)) btRefreshCalendar_();
  } catch (error) {
    btLogSync_("관리자 시트", name, "실패", error.message);
    SpreadsheetApp.getActive().toast(error.message, "동기화 실패", 5);
  }
}

function btUpsertReservationFromApp_(booking) {
  const sheet = btGetSheet_("예약현황");
  const id = String(booking.id || "");
  if (!id) throw new Error("예약 ID가 없어서 시트에 저장하지 못했어요.");

  const foundRow = btFindRowByValue_(sheet, 11, id);
  const values = [
    btMakeReservationNo_(id),
    BT_STATUS_TO_SHEET[booking.status] || "예약 완료",
    booking.patientName || "",
    booking.date || "",
    booking.time || "",
    booking.treatment || "없음",
    Number(booking.waitMinutes || 15),
    new Date(),
    "",
    "예약 페이지",
    id,
    "",
  ];

  const targetRow = foundRow || sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 5).setNumberFormat("@");
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
}

function btCancelReservationFromApp_(booking) {
  const sheet = btGetSheet_("예약현황");
  const id = String(booking.id || "");
  const row = btFindRowByValue_(sheet, 11, id);
  if (!row) {
    btUpsertReservationFromApp_(Object.assign({}, booking, { status: "cancelled" }));
    return;
  }

  sheet.getRange(row, 2).setValue("예약 취소");
  sheet.getRange(row, 9).setValue(new Date());
  sheet.getRange(row, 12).setValue(booking.cancelReason || "");
}

function btSyncReservationRowToSupabase_(sheet, row) {
  const values = sheet.getRange(row, 1, 1, 12).getValues()[0];
  const patientName = String(values[2] || "").trim();
  const appointmentDate = btToDateKey_(values[3]);
  const appointmentTime = btToTimeLabel_(values[4]);
  if (!patientName || !appointmentDate || !appointmentTime) return;

  const id = String(values[10] || Utilities.getUuid());
  const status = BT_STATUS_TO_DB[String(values[1] || "예약 완료")] || "confirmed";
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

  btSupabaseRequest_("reservations", "POST", reservation, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });

  if (!values[10]) {
    sheet.getRange(row, 1).setValue(btMakeReservationNo_(id));
    sheet.getRange(row, 8).setValue(new Date());
    sheet.getRange(row, 10).setValue("관리자 시트");
    sheet.getRange(row, 11).setValue(id);
  }
  btLogSync_("관리자 시트", "예약현황", "성공", id);
}

function btSyncTimeBlockRowToSupabase_(sheet, row) {
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

  btSupabaseRequest_("appointment_time_blocks", "POST", block, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  sheet.getRange(row, 1).setValue(id);
  btLogSync_("관리자 시트", "시간블록", "성공", id);
}

function btSyncWaitRuleRowToSupabase_(sheet, row) {
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

  btSupabaseRequest_("wait_time_rules", "POST", rule, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  sheet.getRange(row, 1).setValue(id);
  btLogSync_("관리자 시트", "대기시간규칙", "성공", id);
}

function btSyncClinicSettingsToSupabase_() {
  const sheet = btGetSheet_("병원설정");
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

  btSupabaseRequest_("clinic_settings", "POST", settings, {
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  btLogSync_("관리자 시트", "병원설정", "성공", settings.clinic_name);
}

function btSupabaseRequest_(path, method, payload, options) {
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

  if (response.getResponseCode() >= 300) throw new Error(response.getContentText());
  const text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

function btGetSheet_(name) {
  const ss = typeof SPREADSHEET_ID !== "undefined" ? SpreadsheetApp.openById(SPREADSHEET_ID) : SpreadsheetApp.getActive();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`${name} 시트를 찾지 못했어요.`);
  return sheet;
}

function btFindRowByValue_(sheet, column, value) {
  if (!value) return 0;
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const values = sheet.getRange(2, column, lastRow - 1, 1).getValues();
  const index = values.findIndex((row) => String(row[0]) === String(value));
  return index >= 0 ? index + 2 : 0;
}

function btMakeReservationNo_(id) {
  return `R-${String(id).slice(0, 8).toUpperCase()}`;
}

function btToDateKey_(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function btToTimeLabel_(value) {
  if (!value) return "";
  if (value instanceof Date) {
    const hour = value.getHours();
    const minute = value.getMinutes();
    return minute ? `${hour}:${String(minute).padStart(2, "0")}` : `${hour}:00`;
  }
  return String(value).trim();
}

function cleanupIntegrationTestRows() {
  const sheet = btGetSheet_("예약현황");
  for (let row = sheet.getLastRow(); row >= 2; row -= 1) {
    if (String(sheet.getRange(row, 3).getValue()).trim() === "연동테스트") {
      sheet.deleteRow(row);
    }
  }
  btRefreshCalendar_();
}

function btRefreshCalendar_() {
  if (typeof setupReservationCalendar === "function") setupReservationCalendar();
}

function btLogSync_(source, action, status, detail) {
  const sheet = btGetSheet_("동기화로그");
  if (!sheet) return;
  sheet.appendRow([new Date(), source, action, status, detail]);
}

function btJson_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

function setupSupabaseSyncTriggers() {
  const spreadsheetId = typeof SPREADSHEET_ID !== "undefined" ? SPREADSHEET_ID : SpreadsheetApp.getActive().getId();
  const triggers = ScriptApp.getProjectTriggers();
  const hasEditTrigger = triggers.some((trigger) => trigger.getHandlerFunction() === "onEdit");

  if (!hasEditTrigger) {
    ScriptApp.newTrigger("onEdit").forSpreadsheet(spreadsheetId).onEdit().create();
  }

  SpreadsheetApp.getActive().toast("구글 시트와 Supabase 실시간 동기화 준비가 끝났어요.", "연결 완료", 5);
}
