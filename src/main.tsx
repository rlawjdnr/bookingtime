import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AnimatePresence, motion } from "framer-motion";
import "@stackflow/react";
import "./styles.css";
import { hasSupabaseConfig, supabase } from "./lib/supabaseClient";
import { syncReservationToGoogleSheet } from "./lib/googleSheetsSync";

import backIcon from "./assets/figma/back.svg";
import calendarIcon from "./assets/figma/calendar-line.svg";
import chevronDownIcon from "./assets/figma/chevron-down.svg";
import closeIcon from "./assets/figma/close-line.svg";
import completeIcon from "./assets/figma/complete.svg";
import hospitalIcon from "./assets/figma/hospital-fill.svg";
import monthNextIcon from "./assets/figma/month-next.svg";
import monthPrevIcon from "./assets/figma/month-prev.svg";
import radioEmptyIcon from "./assets/figma/radio-empty.svg";
import radioSelectedIcon from "./assets/figma/radio-selected.svg";
import snackbarAlertIcon from "./assets/figma/snackbar-alert.svg";
import snackbarCheckIcon from "./assets/figma/snackbar-check.svg";
import treatmentIcon from "./assets/figma/treatment-fill.svg";
import timeCalendarIcon from "./assets/figma/time-calendar-fill.svg";
import waitIcon from "./assets/figma/wait-fill.svg";
import adminMinusIcon from "./assets/figma/admin-minus.svg";
import adminPlusIcon from "./assets/figma/admin-plus.svg";
import adminChipCloseIcon from "./assets/figma/admin-chip-close.svg";
import adminDropdownIcon from "./assets/figma/admin-dropdown.svg";
import adminLogoutIcon from "./assets/figma/admin-logout.svg";
import adminRadioEmptyIcon from "./assets/figma/admin-radio-empty.svg";
import adminRadioSelectedIcon from "./assets/figma/admin-radio-selected.svg";

const ADMIN_SESSION_KEY = "bookingtime-admin-authenticated";

type Route = "time" | "details" | "complete";
type Treatment = string;
type StackEntry = {
  id: number;
  route: Route;
};

type Slot = {
  id: string;
  time: string;
  remaining: number;
  closed?: boolean;
};

type Booking = {
  id: string;
  patientName: string;
  date: string;
  time: string;
  treatment: Treatment;
  waitMinutes: number;
  status: "confirmed" | "cancelled";
  cancelReason?: string;
  createdAt?: string;
};

type ReservationRow = {
  id: string;
  patient_name: string;
  appointment_date: string;
  appointment_time: string;
  treatment: Treatment;
  wait_minutes: number;
  status: "confirmed" | "cancelled";
  cancel_reason?: string | null;
  created_at?: string;
};

type TimeBlockRow = {
  id: string;
  time_label: string;
  capacity: number;
  is_open: boolean;
  sort_order?: number;
};

type ClinicSettings = {
  name: string;
  status: string;
  phone: string;
  openDays: number;
};

type ClinicSettingsRow = {
  clinic_name: string;
  phone: string;
  open_days: number;
};

type DaySetting = {
  date: string;
  isClosed: boolean;
  isOpen: boolean;
};

type DaySettingRow = {
  target_date: string;
  is_closed: boolean;
  is_open: boolean;
};

type TreatmentOption = {
  id: string;
  label: Treatment;
  isOpen: boolean;
  sortOrder: number;
};

type TreatmentOptionRow = {
  id: string;
  label: string;
  is_open: boolean;
  sort_order: number;
};

type WaitRule = {
  timeBlockId: string;
  reservationOrder: number;
  waitMinutes: number;
};

type WaitRuleRow = {
  time_block_id: string;
  reservation_order: number;
  wait_minutes: number;
};

type AppointmentStore = {
  subscribe(listener: () => void): () => void;
  create(booking: Booking): Promise<Booking>;
  cancel(id: string, reason: string): Promise<Booking | undefined>;
  updateReservation(id: string, updates: Partial<Pick<Booking, "patientName" | "treatment" | "status" | "cancelReason">>): Promise<void>;
  list(): Promise<Booking[]>;
  listSlots(): Promise<Slot[]>;
  listWaitRules(): Promise<WaitRule[]>;
  listClinicSettings(): Promise<ClinicSettings>;
  saveClinicSettings(settings: ClinicSettings): Promise<void>;
  listDaySettings(): Promise<DaySetting[]>;
  saveDaySetting(setting: DaySetting): Promise<void>;
  listTreatments(): Promise<TreatmentOption[]>;
  saveTreatments(options: TreatmentOption[]): Promise<void>;
  saveSlot(slot: Slot, sortOrder: number): Promise<void>;
  saveWaitInterval(slots: Slot[], intervalMinutes: number): Promise<void>;
};

const activeBookingStorageKey = "hospital-reservation.activeBooking";

const fallbackClinic = {
  name: "이목구비 김한의원",
  status: "오늘 진료중",
  phone: "055-335-9799",
  openDays: 7,
};

const initialSlots: Slot[] = [
  { id: "0930", time: "9:30", remaining: 5 },
  { id: "1015", time: "10:15", remaining: 5 },
  { id: "1100", time: "11:00", remaining: 1 },
  { id: "1145", time: "11:45", remaining: 5 },
  { id: "1400", time: "14:00", remaining: 5 },
  { id: "1510", time: "15:10", remaining: 5 },
  { id: "1620", time: "16:20", remaining: 5 },
  { id: "1730", time: "17:30", remaining: 5 },
];

const fallbackTreatments: TreatmentOption[] = [
  { id: "none", label: "없음", isOpen: true, sortOrder: 0 },
  { id: "acupuncture", label: "침 치료", isOpen: true, sortOrder: 10 },
  { id: "herbal", label: "한약 처방", isOpen: true, sortOrder: 20 },
];
const cancelReasons = ["시간 변경", "단순 변심"];
const spring = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.9 };
const screenSpring = { type: "spring" as const, stiffness: 480, damping: 50 };
const snackbarSpring = { type: "spring" as const, stiffness: 480, damping: 50 };
const overlaySpring = { type: "spring" as const, stiffness: 800, damping: 55 };
const tapSpring = { type: "spring" as const, stiffness: 1000, damping: 55 };
const tapReleaseSpring = { type: "spring" as const, stiffness: 800, damping: 55 };
const screenVariants = {
  enter: (latestDirection: number) => ({ x: latestDirection > 0 ? "100%" : "-50%" }),
  center: { x: "0%" },
  covered: { x: "-50%" },
  exit: (latestDirection: number) => ({ x: latestDirection > 0 ? "-50%" : "100%" }),
};

class SyncReadyAppointmentStore implements AppointmentStore {
  private bookings: Booking[] = [];
  private listeners = new Set<() => void>();
  private isRemoteReady = hasSupabaseConfig && Boolean(supabase);
  private shouldRequireRemote = import.meta.env.PROD;
  private realtimeChannel: ReturnType<NonNullable<typeof supabase>["channel"]> | null = null;

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    this.ensureRealtime();
    return () => {
      this.listeners.delete(listener);
    };
  }

  async create(booking: Booking) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("reservations").insert(toReservationRow(booking));
      if (error) throw error;
    }

    this.bookings = [booking, ...this.bookings.filter((item) => item.id !== booking.id)];
    this.emit();
    this.sync("create", booking);
    return booking;
  }

  async cancel(id: string, reason: string) {
    const booking = this.bookings.find((item) => item.id === id);
    if (!booking) return undefined;
    const cancelled = { ...booking, status: "cancelled" as const, cancelReason: reason };

    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase
        .from("reservations")
        .update({ status: "cancelled", cancel_reason: reason, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    }

    this.bookings = this.bookings.map((item) => (item.id === id ? cancelled : item));
    this.emit();
    this.sync("cancel", { ...cancelled, cancelReason: reason });
    return cancelled;
  }

  async updateReservation(id: string, updates: Partial<Pick<Booking, "patientName" | "treatment" | "status" | "cancelReason">>) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    const rowUpdates: Partial<ReservationRow> & { updated_at?: string } = {
      updated_at: new Date().toISOString(),
    };
    if (updates.patientName !== undefined) rowUpdates.patient_name = updates.patientName;
    if (updates.treatment !== undefined) rowUpdates.treatment = updates.treatment;
    if (updates.status !== undefined) rowUpdates.status = updates.status;
    if (updates.cancelReason !== undefined) rowUpdates.cancel_reason = updates.cancelReason;

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("reservations").update(rowUpdates).eq("id", id);
      if (error) throw error;
    }

    this.bookings = this.bookings.map((item) => (item.id === id ? { ...item, ...updates } : item));
    this.emit();
  }

  async list() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase.from("reservations").select("*").order("created_at", { ascending: false });
      if (error) throw error;
      this.bookings = (data || []).map(fromReservationRow);
    }

    return this.bookings;
  }

  async listSlots() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase
        .from("appointment_time_blocks")
        .select("*")
        .eq("is_open", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      if (data?.length) return data.map(fromTimeBlockRow);
    }

    return initialSlots;
  }

  async listWaitRules() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase
        .from("wait_time_rules")
        .select("time_block_id,reservation_order,wait_minutes")
        .order("time_block_id", { ascending: true })
        .order("reservation_order", { ascending: true });
      if (error) throw error;
      return (data || []).map(fromWaitRuleRow);
    }

    return [];
  }

  async listClinicSettings() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase
        .from("clinic_settings")
        .select("clinic_name,phone,open_days")
        .eq("id", "default")
        .maybeSingle();
      if (error) throw error;
      if (data) return fromClinicSettingsRow(data);
    }

    return fallbackClinic;
  }

  async saveClinicSettings(settings: ClinicSettings) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("clinic_settings").upsert({
        id: "default",
        clinic_name: settings.name,
        phone: settings.phone,
        open_days: settings.openDays,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
    this.emit();
  }

  async listDaySettings() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase
        .from("clinic_day_settings")
        .select("target_date,is_closed,is_open")
        .order("target_date", { ascending: true });
      if (error) {
        if (isMissingOptionalTableError(error)) return [];
        throw error;
      }
      return (data || []).map(fromDaySettingRow);
    }

    return [];
  }

  async saveDaySetting(setting: DaySetting) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("clinic_day_settings").upsert({
        target_date: setting.date,
        is_closed: setting.isClosed,
        is_open: setting.isOpen,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
    this.emit();
  }

  async listTreatments() {
    if (this.isRemoteReady && supabase) {
      const { data, error } = await supabase
        .from("treatment_options")
        .select("id,label,is_open,sort_order")
        .eq("is_open", true)
        .order("sort_order", { ascending: true });
      if (error) {
        if (isMissingOptionalTableError(error)) return fallbackTreatments;
        throw error;
      }
      if (data?.length) return data.map(fromTreatmentOptionRow);
    }

    return fallbackTreatments;
  }

  async saveTreatments(options: TreatmentOption[]) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("treatment_options").upsert(
        options.map((option, index) => ({
          id: option.id,
          label: option.label,
          is_open: option.isOpen,
          sort_order: index * 10,
        })),
      );
      if (error) throw error;
    }
    this.emit();
  }

  async saveSlot(slot: Slot, sortOrder: number) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("appointment_time_blocks").upsert({
        id: slot.id,
        time_label: slot.time,
        capacity: slot.remaining,
        is_open: !slot.closed,
        sort_order: sortOrder,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
    }
    this.emit();
  }

  async saveWaitInterval(slots: Slot[], intervalMinutes: number) {
    if (!this.isRemoteReady && this.shouldRequireRemote) {
      throw new Error("Supabase 환경변수가 배포에 반영되지 않았어요.");
    }

    const rules = slots.flatMap((slot) =>
      Array.from({ length: Math.max(1, slot.remaining) }, (_, index) => ({
        time_block_id: slot.id,
        reservation_order: index + 1,
        wait_minutes: (index + 1) * intervalMinutes,
      })),
    );

    if (this.isRemoteReady && supabase) {
      const { error } = await supabase.from("wait_time_rules").upsert(rules, {
        onConflict: "time_block_id,reservation_order",
      });
      if (error) throw error;
    }
    this.emit();
  }

  private ensureRealtime() {
    if (!this.isRemoteReady || !supabase || this.realtimeChannel) return;

    this.realtimeChannel = supabase
      .channel("reservation-admin-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "reservations" }, () => {
        void this.list().then(() => this.emit());
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "appointment_time_blocks" }, () => {
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "wait_time_rules" }, () => {
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "clinic_settings" }, () => {
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "clinic_day_settings" }, () => {
        this.emit();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "treatment_options" }, () => {
        this.emit();
      })
      .subscribe();
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  private sync(action: "create" | "cancel", payload: unknown) {
    window.dispatchEvent(new CustomEvent("reservation-sync", { detail: { action, payload } }));
    syncReservationToGoogleSheet(action, payload);
  }
}

const appointmentStore = new SyncReadyAppointmentStore();

function App() {
  const restoredBooking = useMemo(() => loadActiveBooking(), []);
  const stackIdRef = useRef(1);
  const stackMotionLockRef = useRef<number | null>(null);
  const [stack, setStack] = useState<StackEntry[]>([
    { id: 0, route: restoredBooking ? "complete" : "time" },
  ]);
  const [direction, setDirection] = useState(1);
  const [selectedDate, setSelectedDate] = useState(restoredBooking ? parseBookingDate(restoredBooking.date) : getToday());
  const [selectedSlotId, setSelectedSlotId] = useState(restoredBooking ? getSlotIdByTime(restoredBooking.time) : "1400");
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [patientName, setPatientName] = useState(restoredBooking?.patientName ?? "");
  const [treatment, setTreatment] = useState<Treatment>(restoredBooking?.treatment ?? "없음");
  const [booking, setBooking] = useState<Booking | null>(restoredBooking);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [baseSlots, setBaseSlots] = useState<Slot[]>(initialSlots);
  const [waitRules, setWaitRules] = useState<WaitRule[]>([]);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings>(fallbackClinic);
  const [daySettings, setDaySettings] = useState<DaySetting[]>([]);
  const [treatmentOptions, setTreatmentOptions] = useState<TreatmentOption[]>(fallbackTreatments);
  const [toast, setToast] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [skipStackMotion, setSkipStackMotion] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const slots = useMemo(() => {
    const daySetting = getDaySetting(daySettings, selectedDate);
    const dayOpen = daySetting?.isOpen ?? isDefaultOpenBookingDate(selectedDate, clinicSettings.openDays);
    const dayClosed = Boolean(daySetting?.isClosed) || !dayOpen;
    return applyBookingsToSlots(baseSlots, selectedDate, bookings, dayClosed);
  }, [baseSlots, bookings, clinicSettings.openDays, daySettings, selectedDate]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? slots.find((slot) => !slot.closed) ?? initialSlots[0];

  useEffect(() => {
    if (!selectedSlot.closed) return;
    const firstOpenSlot = slots.find((slot) => !slot.closed);
    if (firstOpenSlot) setSelectedSlotId(firstOpenSlot.id);
  }, [selectedSlot.closed, slots]);

  useEffect(() => {
    let isMounted = true;

    const loadAdminData = () => {
      void Promise.all([
        appointmentStore.list(),
        appointmentStore.listSlots(),
        appointmentStore.listWaitRules(),
        appointmentStore.listClinicSettings(),
        appointmentStore.listDaySettings(),
        appointmentStore.listTreatments(),
      ])
        .then(([items, nextSlots, nextWaitRules, nextClinicSettings, nextDaySettings, nextTreatmentOptions]) => {
          if (!isMounted) return;
          setBookings(items);
          setBaseSlots(nextSlots);
          setWaitRules(nextWaitRules);
          setClinicSettings(nextClinicSettings);
          setDaySettings(nextDaySettings);
          setTreatmentOptions(nextTreatmentOptions);
        })
        .catch(() => {
          if (!isMounted) return;
          setBookings([]);
          setBaseSlots(initialSlots);
          setWaitRules([]);
          setClinicSettings(fallbackClinic);
          setDaySettings([]);
          setTreatmentOptions(fallbackTreatments);
        });
    };

    loadAdminData();
    const unsubscribe = appointmentStore.subscribe(loadAdminData);

    return () => {
      isMounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!skipStackMotion) return;
    const frame = window.requestAnimationFrame(() => setSkipStackMotion(false));
    return () => window.cancelAnimationFrame(frame);
  }, [skipStackMotion]);

  useEffect(() => {
    return () => {
      if (stackMotionLockRef.current) window.clearTimeout(stackMotionLockRef.current);
    };
  }, []);

  const push = (route: Route) => {
    if (stackMotionLockRef.current) return;
    setDirection(1);
    setStack((prev) => {
      if (prev[prev.length - 1]?.route === route) return prev;
      return [...prev, { id: stackIdRef.current++, route }];
    });
    lockStackMotion();
  };

  const back = () => {
    if (stackMotionLockRef.current) return;
    setDirection(-1);
    setStack((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
    lockStackMotion();
  };

  const resetStack = (route: Route) => {
    if (stackMotionLockRef.current) {
      window.clearTimeout(stackMotionLockRef.current);
      stackMotionLockRef.current = null;
    }
    setStack([{ id: stackIdRef.current++, route }]);
  };

  function lockStackMotion() {
    if (stackMotionLockRef.current) window.clearTimeout(stackMotionLockRef.current);
    stackMotionLockRef.current = window.setTimeout(() => {
      stackMotionLockRef.current = null;
    }, 560);
  }

  const appointmentLabel = `${formatShortDate(selectedDate)} ${selectedSlot.time}`;
  const waitMinutes = getWaitMinutesForNextReservation(selectedSlot, selectedDate, bookings, waitRules);
  const canContinue = Boolean(selectedSlot && !selectedSlot.closed);
  const canBook = patientName.trim().length > 0;

  const submitBooking = async () => {
    if (!canBook) return;
    const nextBooking: Booking = {
      id: crypto.randomUUID(),
      patientName: patientName.trim(),
      date: toDateKey(selectedDate),
      time: selectedSlot.time,
      treatment,
      waitMinutes,
      status: "confirmed",
      createdAt: new Date().toISOString(),
    };
    try {
      await appointmentStore.create(nextBooking);
      saveActiveBooking(nextBooking);
      setBooking(nextBooking);
      push("complete");
    } catch (error) {
      console.error("Failed to create reservation", error);
      setToast(getReservationErrorMessage(error));
    }
  };

  const cancelBooking = async (reason: string) => {
    if (!booking) return;
    setIsCancelling(true);
    try {
      await appointmentStore.cancel(booking.id, reason);
      clearActiveBooking();
      setSkipStackMotion(true);
      setDirection(-1);
      resetStack("time");
      window.setTimeout(() => {
        setIsCancelOpen(false);
        setIsCancelling(false);
        setToast("예약을 취소했어요");
      }, 180);
    } catch (error) {
      console.error("Failed to cancel reservation", error);
      setIsCancelling(false);
      setToast("예약 취소에 실패했어요");
    }
  };

  useEffect(() => {
    if (!treatmentOptions.length || treatmentOptions.some((option) => option.label === treatment)) return;
    setTreatment(treatmentOptions[0].label);
  }, [treatment, treatmentOptions]);

  useEffect(() => {
    if (!booking) return;
    const remoteBooking = bookings.find((item) => item.id === booking.id);
    if (!remoteBooking || remoteBooking.status !== "cancelled") return;
    clearActiveBooking();
    setBooking(null);
    setSkipStackMotion(true);
    resetStack("time");
    setToast("예약이 취소됐어요");
  }, [booking, bookings]);

  return (
    <main className="app-shell">
      <div className="phone-frame">
        <AnimatePresence custom={direction} initial={false}>
          {stack.map(({ id, route }, index) => {
            const isTop = index === stack.length - 1;

            return (
              <ScreenMotion key={id} direction={direction} index={index} isTop={isTop} instant={skipStackMotion}>
                {route === "time" && (
                  <TimeScreen
                    clinicSettings={clinicSettings}
                    selectedDate={selectedDate}
                    selectedSlotId={selectedSlotId}
                    slots={slots}
                    onOpenCalendar={() => setIsCalendarOpen(true)}
                    onSelectSlot={(slot) => {
                      if (slot.closed) {
                        setToast("접수가 마감된 시간이에요");
                        return;
                      }
                      setToast("");
                      setSelectedSlotId(slot.id);
                    }}
                    onNext={() => {
                      if (!canContinue) return;
                      flushSync(() => push("details"));
                    }}
                  />
                )}
                {route === "details" && (
                  <DetailsScreen
                    clinicSettings={clinicSettings}
                    treatmentOptions={treatmentOptions}
                    appointmentLabel={appointmentLabel}
                    waitMinutes={waitMinutes}
                    canBook={canBook}
                    name={patientName}
                    treatment={treatment}
                    onBack={back}
                    onNameChange={setPatientName}
                    onTreatmentChange={setTreatment}
                    onSubmit={() => setIsConfirmOpen(true)}
                  />
                )}
                {route === "complete" && booking && (
                  <CompleteScreen clinicSettings={clinicSettings} booking={booking} onCancel={() => setIsCancelOpen(true)} />
                )}
              </ScreenMotion>
            );
          })}
        </AnimatePresence>
        <AnimatePresence>
          {isConfirmOpen && (
            <ConfirmBookingSheet
              appointmentLabel={appointmentLabel}
              waitMinutes={waitMinutes}
              patientName={patientName.trim()}
              treatment={treatment}
              onClose={() => setIsConfirmOpen(false)}
              onConfirm={() => {
                setIsConfirmOpen(false);
                void submitBooking();
              }}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isCancelOpen && (
            <CancelModal
              clinicSettings={clinicSettings}
              isCancelling={isCancelling}
              onClose={() => setIsCancelOpen(false)}
              onSubmit={cancelBooking}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isCalendarOpen && (
            <CalendarSheet
              openDays={clinicSettings.openDays}
              daySettings={daySettings}
              selectedDate={selectedDate}
              onClose={() => setIsCalendarOpen(false)}
              onBlockedDate={(message) => setToast(message)}
              onSelect={(date) => {
                setSelectedDate(date);
                setIsCalendarOpen(false);
              }}
            />
          )}
        </AnimatePresence>
        <Toast message={toast} onDismiss={() => setToast("")} />
      </div>
    </main>
  );
}

function CancelModal({
  clinicSettings,
  isCancelling,
  onClose,
  onSubmit,
}: {
  clinicSettings: ClinicSettings;
  isCancelling: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  return (
    <motion.section
      className="screen cancel-modal"
      initial={{ y: "100%" }}
      animate={{ y: 0 }}
      exit={{ y: "100%" }}
      transition={screenSpring}
      style={{ zIndex: 40 }}
    >
      <AnimatePresence>
        {isCancelling && (
          <motion.div
            className="loading-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08 }}
          >
            <span />
          </motion.div>
        )}
      </AnimatePresence>
      <CancelScreen clinicSettings={clinicSettings} onClose={onClose} onSubmit={onSubmit} />
    </motion.section>
  );
}

function ConfirmBookingSheet({
  appointmentLabel,
  waitMinutes,
  patientName,
  treatment,
  onClose,
  onConfirm,
}: {
  appointmentLabel: string;
  waitMinutes: number;
  patientName: string;
  treatment: Treatment;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <motion.div className="sheet-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring} onClick={onClose}>
      <motion.section
        className="confirm-sheet"
        initial={{ y: 338 }}
        animate={{ y: 0 }}
        exit={{ y: 338 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <h1>
          {patientName}님 예약하기 전에
          <br />
          마지막으로 확인해주세요
        </h1>
        <SummaryCard
          rows={[
            ["예약 시간", appointmentLabel, timeCalendarIcon],
            ["대기 시간", `${waitMinutes}분`, waitIcon],
            ["진료 과목", treatment, treatmentIcon],
          ]}
        />
        <div className="confirm-actions">
          <TapButton className="light-button" onClick={onClose}>취소</TapButton>
          <TapButton className="primary-button" onClick={onConfirm}>진료 예약하기</TapButton>
        </div>
      </motion.section>
    </motion.div>
  );
}

function ScreenMotion({
  children,
  direction,
  index,
  isTop,
  instant,
}: {
  children: React.ReactNode;
  direction: number;
  index: number;
  isTop: boolean;
  instant?: boolean;
}) {
  return (
    <motion.section
      className="screen"
      custom={direction}
      variants={screenVariants}
      initial="enter"
      animate={isTop ? "center" : "covered"}
      exit="exit"
      transition={instant ? { duration: 0 } : screenSpring}
      style={{ zIndex: index + 1, pointerEvents: isTop ? "auto" : "none" }}
    >
      {children}
      <motion.div
        className="screen-dim"
        animate={{ opacity: isTop ? 0 : 0.12 }}
        transition={screenSpring}
      />
    </motion.section>
  );
}

function TapButton(props: React.ComponentProps<typeof motion.button>) {
  const { children, disabled, transition, ...rest } = props;

  return (
    <motion.button
      animate={{ scale: 1 }}
      whileTap={disabled ? undefined : { scale: 0.98, transition: tapSpring }}
      transition={transition ?? tapReleaseSpring}
      disabled={disabled}
      {...rest}
    >
      {children}
    </motion.button>
  );
}

function AdminStatusSelect(props: {
  booking: Booking;
  onUpdate: (updates: Partial<Pick<Booking, "status" | "cancelReason">>) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const statusOptions: Array<{ status: Booking["status"]; label: string }> = [
    { status: "confirmed", label: "예약완료" },
    { status: "cancelled", label: "예약취소" },
  ];

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const selectStatus = (status: Booking["status"]) => {
    props.onUpdate({
      status,
      cancelReason: status === "cancelled" ? props.booking.cancelReason || "관리자 취소" : "",
    });
    setIsOpen(false);
  };

  return (
    <div className="admin-status-select" ref={rootRef}>
      <TapButton className="admin-status-chip" onClick={() => setIsOpen((value) => !value)} aria-expanded={isOpen}>
        {props.booking.status === "confirmed" ? "예약 완료" : "예약 취소"}
        <img className="svg-icon" src={adminDropdownIcon} alt="" />
      </TapButton>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="admin-status-popover"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={overlaySpring}
          >
            {statusOptions.map((option) => (
              <TapButton
                className={props.booking.status === option.status ? "selected" : ""}
                key={option.status}
                onClick={() => selectStatus(option.status)}
              >
                {option.label}
              </TapButton>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AdminSwitch(props: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <TapButton
      className={`admin-switch ${props.checked ? "checked" : ""}`}
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      onClick={() => props.onChange(!props.checked)}
    >
      <motion.span layout transition={overlaySpring} />
    </TapButton>
  );
}

function Header({
  clinicSettings,
  back,
  compact = false,
  complete = false,
}: {
  clinicSettings: ClinicSettings;
  back?: () => void;
  compact?: boolean;
  complete?: boolean;
}) {
  if (complete) {
    return (
      <header className="topbar complete-topbar">
        <strong className="complete-header-title">{clinicSettings.name}</strong>
      </header>
    );
  }

  return (
    <header className={compact ? "topbar centered" : "topbar"}>
      {back ? (
        <TapButton className="icon-button" onClick={back} aria-label="뒤로가기">
          <img className="svg-icon back-icon" src={backIcon} alt="" />
        </TapButton>
      ) : (
        <div className="clinic-title">
          <span className="icon-18"><img className="svg-icon hospital-icon" src={hospitalIcon} alt="" /></span>
          <strong>{clinicSettings.name}</strong>
        </div>
      )}
      {back && <strong className="header-title">{clinicSettings.name}</strong>}
      {!back && <span className="clinic-status">{clinicSettings.status}</span>}
      {back && <span className="header-spacer" />}
    </header>
  );
}

function TimeScreen(props: {
  clinicSettings: ClinicSettings;
  selectedDate: Date;
  selectedSlotId: string;
  slots: Slot[];
  onOpenCalendar: () => void;
  onSelectSlot: (slot: Slot) => void;
  onNext: () => void;
}) {
  const visibleSlots = getVisibleSlotsForDate(props.slots, props.selectedDate);
  const morning = visibleSlots.filter((slot) => Number(slot.time.split(":")[0]) < 13);
  const afternoon = visibleSlots.filter((slot) => Number(slot.time.split(":")[0]) >= 13);
  const selectedSlot = visibleSlots.find((slot) => slot.id === props.selectedSlotId) ?? visibleSlots.find((slot) => !slot.closed);
  const relativeDateLabel = getRelativeDateLabel(props.selectedDate);

  return (
    <>
      <Header clinicSettings={props.clinicSettings} />
      <div className="content">
        <h1 className="screen-title">언제 진료를 원하시나요?</h1>
        <TapButton className="date-select" onClick={props.onOpenCalendar}>
          <span>
            <img className="svg-icon calendar-icon" src={calendarIcon} alt="" />
            {relativeDateLabel && <strong>{relativeDateLabel}</strong>}
            <span>{formatMonthDayWeek(props.selectedDate)}</span>
          </span>
          <img className="svg-icon chevron" src={chevronDownIcon} alt="" />
        </TapButton>
        <SlotGroup title="오전" slots={morning} selectedId={props.selectedSlotId} onSelect={props.onSelectSlot} />
        <SlotGroup title="오후" slots={afternoon} selectedId={props.selectedSlotId} onSelect={props.onSelectSlot} />
      </div>
      <BottomCTA disabled={!selectedSlot || selectedSlot.closed} onClick={props.onNext}>
        {selectedSlot && !selectedSlot.closed ? `${selectedSlot.time} 진료 예약하기` : "원하는 시간을 선택해주세요"}
      </BottomCTA>
    </>
  );
}

function SlotGroup(props: { title: string; slots: Slot[]; selectedId: string; onSelect: (slot: Slot) => void }) {
  if (!props.slots.length) return null;

  return (
    <section className="slot-section">
      <p>{props.title}</p>
      <div className="slot-grid">
        {props.slots.map((slot) => {
          const selected = slot.id === props.selectedId;
          return (
            <TapButton
              className={`slot-card ${selected ? "selected" : ""} ${slot.closed ? "closed" : ""}`}
              key={slot.id}
              onClick={() => props.onSelect(slot)}
            >
              <strong>{slot.time}</strong>
              <span>{slot.closed ? "접수 마감" : `${slot.remaining}명 남음`}</span>
            </TapButton>
          );
        })}
      </div>
    </section>
  );
}

function DetailsScreen(props: {
  clinicSettings: ClinicSettings;
  treatmentOptions: TreatmentOption[];
  appointmentLabel: string;
  waitMinutes: number;
  canBook: boolean;
  name: string;
  treatment: Treatment;
  onBack: () => void;
  onNameChange: (name: string) => void;
  onTreatmentChange: (treatment: Treatment) => void;
  onSubmit: () => void;
}) {
  const nameInputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    focusNameInput();
    const frame = window.requestAnimationFrame(focusNameInput);
    const timer = window.setTimeout(focusNameInput, 120);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, []);

  function focusNameInput() {
    const input = nameInputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const cursorPosition = input.value.length;
    input.setSelectionRange(cursorPosition, cursorPosition);
  }

  useEffect(() => {
    const timer = window.setTimeout(focusNameInput, 360);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <>
      <Header clinicSettings={props.clinicSettings} back={props.onBack} compact />
      <div className="content details-content">
        <SummaryCard rows={[["예약 시간", props.appointmentLabel, timeCalendarIcon], ["대기 시간", `${props.waitMinutes}분`, waitIcon]]} />
        <label className="field-block">
          <span>이름을 입력해 주세요</span>
          <input
            ref={nameInputRef}
            value={props.name}
            onChange={(event) => props.onNameChange(event.target.value)}
            placeholder="이름 입력"
            autoFocus
          />
        </label>
        <section className="field-block">
          <span>어떤 진료를 원하시나요?</span>
          <div className="option-list">
            {props.treatmentOptions.map(({ label: item }) => (
              <TapButton
                className={`option-row ${props.treatment === item ? "selected" : ""}`}
                key={item}
                onClick={() => props.onTreatmentChange(item)}
              >
                <strong>{item}</strong>
                <img className="svg-icon radio-icon" src={props.treatment === item ? radioSelectedIcon : radioEmptyIcon} alt="" />
              </TapButton>
            ))}
          </div>
        </section>
      </div>
      <BottomCTA disabled={!props.canBook} onClick={props.onSubmit}>
        {props.canBook ? "진료 예약하기" : "이름을 입력해주세요"}
      </BottomCTA>
    </>
  );
}

function CompleteScreen({ clinicSettings, booking, onCancel }: { clinicSettings: ClinicSettings; booking: Booking; onCancel: () => void }) {
  return (
    <>
      <Header clinicSettings={clinicSettings} complete />
      <section className="complete-message">
        <img className="svg-icon complete-icon" src={completeIcon} alt="" />
        <h1>
          {`${booking.patientName}님`}
          <br />
          {formatShortDate(parseBookingDate(booking.date))} {booking.time}에
          <br />
          예약을 완료했어요
        </h1>
      </section>
      <div className="complete-summary">
        <SummaryCard
          rows={[
            ["예약 시간", `${formatShortDate(parseBookingDate(booking.date))} ${booking.time}`, timeCalendarIcon],
            ["대기 시간", `${booking.waitMinutes}분`, waitIcon],
            ["진료 과목", booking.treatment, treatmentIcon],
          ]}
          flat
          hideIcons
        />
      </div>
      <div className="bottom-stack">
        <TapButton className="danger-button" onClick={onCancel}>예약 취소하기</TapButton>
        <a className="light-button" href={toPhoneHref(clinicSettings.phone)}>전화 문의</a>
      </div>
    </>
  );
}

function CancelHeader({ clinicSettings, onClose }: { clinicSettings: ClinicSettings; onClose: () => void }) {
  return (
    <header className="topbar centered">
      <TapButton className="icon-button close-button" onClick={onClose} aria-label="닫기">
        <img className="svg-icon close-icon" src={closeIcon} alt="" />
      </TapButton>
      <strong className="header-title">{clinicSettings.name}</strong>
      <span className="header-spacer" />
    </header>
  );
}

function CancelScreen({
  clinicSettings,
  onClose,
  onSubmit,
}: {
  clinicSettings: ClinicSettings;
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("단순 변심");
  const [custom, setCustom] = useState("");
  const isCustomReason = reason === "직접 입력";
  const finalReason = isCustomReason ? custom.trim() || "직접 입력" : reason;

  return (
    <>
      <CancelHeader clinicSettings={clinicSettings} onClose={onClose} />
      <div className="content cancel-content">
        <h1>
          어떤 이유로
          <br />
          예약 취소를 원하시나요?
        </h1>
        <div className="option-list">
          {cancelReasons.map((item) => (
            <TapButton className={`option-row ${reason === item ? "selected" : ""}`} key={item} onClick={() => { setReason(item); setCustom(""); }}>
              <strong>{item}</strong>
              <img className="svg-icon radio-icon" src={reason === item ? radioSelectedIcon : radioEmptyIcon} alt="" />
            </TapButton>
          ))}
          <textarea
            className={isCustomReason ? "selected" : ""}
            value={custom}
            onChange={(event) => {
              setReason("직접 입력");
              setCustom(event.target.value);
            }}
            onFocus={() => setReason("직접 입력")}
            placeholder="직접 입력"
          />
        </div>
      </div>
      <BottomCTA variant="danger" onClick={() => onSubmit(finalReason)}>예약 취소하기</BottomCTA>
    </>
  );
}

function CalendarSheet(props: {
  openDays: number;
  daySettings: DaySetting[];
  selectedDate: Date;
  onClose: () => void;
  onBlockedDate: (message: string) => void;
  onSelect: (date: Date) => void;
}) {
  const isDateOpen = (date: Date) => isAdminOpenDate(date, props.openDays, props.daySettings);
  const safeSelectedDate = isDateOpen(props.selectedDate) ? props.selectedDate : getToday();
  const [viewDate, setViewDate] = useState(new Date(safeSelectedDate));
  const [focusedDate, setFocusedDate] = useState(new Date(safeSelectedDate));
  const days = useMemo(() => makeCalendarDays(viewDate), [viewDate]);

  return (
    <motion.div className="sheet-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={spring} onClick={props.onClose}>
      <motion.section
        className="calendar-sheet"
        initial={{ y: 525 }}
        animate={{ y: 0 }}
        exit={{ y: 525 }}
        transition={spring}
        onClick={(event) => event.stopPropagation()}
      >
        <h1>언제 진료를 원하시나요?</h1>
        <div className="month-control">
          <TapButton onClick={() => moveCalendarMonth(-1)} aria-label="이전 달">
            <img className="svg-icon month-arrow" src={monthPrevIcon} alt="" />
          </TapButton>
          <strong>{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</strong>
          <TapButton onClick={() => moveCalendarMonth(1)} aria-label="다음 달">
            <img src={monthNextIcon} alt="" className="svg-icon month-arrow" />
          </TapButton>
        </div>
        <div className="calendar-grid weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="calendar-grid">
          {days.map((date, index) => {
            const dayStatus = date ? getAdminCalendarDayStatus(date, props.openDays, props.daySettings) : "open";
            const isPicked = date && sameDay(date, focusedDate);

            return (
              <TapButton
                key={date ? date.toISOString() : `empty-${index}`}
                className={[
                  isPicked ? "picked" : "",
                  dayStatus === "closed" ? "closed" : "",
                  dayStatus === "unopened" ? "unopened" : "",
                ].filter(Boolean).join(" ")}
                disabled={!date}
                onClick={() => {
                  if (!date) return;

                  if (dayStatus === "closed") {
                    props.onBlockedDate("진료하지 않는 날이에요");
                    return;
                  }

                  if (dayStatus === "unopened" || !isDateOpen(date)) {
                    props.onBlockedDate("아직 예약이 열리지 않은 날이에요");
                    return;
                  }

                  setFocusedDate(date);
                }}
              >
                {date?.getDate()}
              </TapButton>
            );
          })}
        </div>
        <BottomCTA inSheet disabled={!isDateOpen(focusedDate)} onClick={() => props.onSelect(focusedDate)}>선택하기</BottomCTA>
      </motion.section>
    </motion.div>
  );

  function moveCalendarMonth(offset: number) {
    const nextMonth = new Date(viewDate.getFullYear(), viewDate.getMonth() + offset, 1);
    const lastDay = new Date(nextMonth.getFullYear(), nextMonth.getMonth() + 1, 0).getDate();
    const preferredDate = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth(),
      Math.min(focusedDate.getDate(), lastDay),
    );
    const nextFocusedDate = isDateOpen(preferredDate) ? preferredDate : getToday();

    setViewDate(nextMonth);
    setFocusedDate(nextFocusedDate);
  }
}

function SummaryCard({ rows, flat = false, hideIcons = false }: { rows: [string, string, string][]; flat?: boolean; hideIcons?: boolean }) {
  return (
    <section className={`${flat ? "summary flat" : "summary"} ${hideIcons ? "no-icons" : ""}`}>
      {rows.map(([label, value, icon]) => (
        <div className="summary-row" key={label}>
          <span>{!hideIcons && <img className="svg-icon summary-icon" src={icon} alt="" />}{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </section>
  );
}

function Toast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const icon = message.includes("마감") || message.includes("진료하지") || message.includes("예약이 열리지") ? snackbarAlertIcon : snackbarCheckIcon;

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 3000);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  return (
    <AnimatePresence>
      {message && (
        <motion.div
          className="toast"
          initial={{ y: "calc(100% + 112px)", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "calc(100% + 112px)", opacity: 0 }}
          transition={{ y: snackbarSpring, opacity: { duration: 0.08 } }}
        >
          <span><img className="svg-icon snackbar-icon" src={icon} alt="" />{message}</span>
          <TapButton onClick={onDismiss}>확인</TapButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function BottomCTA(props: { children: React.ReactNode; disabled?: boolean; variant?: "default" | "danger"; inSheet?: boolean; onClick: () => void }) {
  return (
    <div className={props.inSheet ? "bottom-cta in-sheet" : "bottom-cta"}>
      <TapButton className={props.variant === "danger" ? "danger-button" : "primary-button"} disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </TapButton>
    </div>
  );
}

function AdminApp() {
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(
    () => sessionStorage.getItem(ADMIN_SESSION_KEY) === "true",
  );
  const [activeTab, setActiveTab] = useState<"reservations" | "settings">(
    window.location.pathname.startsWith("/admin/settings") ? "settings" : "reservations",
  );
  const [selectedDate, setSelectedDate] = useState(getToday());
  const [viewDate, setViewDate] = useState(getToday());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [baseSlots, setBaseSlots] = useState<Slot[]>(initialSlots);
  const [waitRules, setWaitRules] = useState<WaitRule[]>([]);
  const [clinicSettings, setClinicSettings] = useState<ClinicSettings>(fallbackClinic);
  const [daySettings, setDaySettings] = useState<DaySetting[]>([]);
  const [treatmentOptions, setTreatmentOptions] = useState<TreatmentOption[]>(fallbackTreatments);
  const [editingSlot, setEditingSlot] = useState<Slot | null>(null);
  const [toast, setToast] = useState("");

  const loadAdminData = () => {
    void Promise.all([
      appointmentStore.list(),
      appointmentStore.listSlots(),
      appointmentStore.listWaitRules(),
      appointmentStore.listClinicSettings(),
      appointmentStore.listDaySettings(),
      appointmentStore.listTreatments(),
    ])
      .then(([items, nextSlots, nextWaitRules, nextClinicSettings, nextDaySettings, nextTreatmentOptions]) => {
        setBookings(items);
        setBaseSlots(nextSlots);
        setWaitRules(nextWaitRules);
        setClinicSettings(nextClinicSettings);
        setDaySettings(nextDaySettings);
        setTreatmentOptions(nextTreatmentOptions);
      })
      .catch((error) => {
        console.error("Failed to load admin data", error);
        setToast(getReservationErrorMessage(error));
      });
  };

  useEffect(() => {
    if (!isAdminAuthenticated) return;
    loadAdminData();
    return appointmentStore.subscribe(loadAdminData);
  }, [isAdminAuthenticated]);

  const treatmentLabels = treatmentOptions.map((option) => option.label);
  const selectedDaySetting = getDaySetting(daySettings, selectedDate);
  const selectedDayOpen = selectedDaySetting?.isOpen ?? isDefaultOpenBookingDate(selectedDate, clinicSettings.openDays);
  const selectedDayClosed = Boolean(selectedDaySetting?.isClosed) || !selectedDayOpen;
  const displaySlots = applyBookingsToSlots(baseSlots, selectedDate, bookings, selectedDayClosed);

  if (!isAdminAuthenticated) {
    return (
      <AdminLoginScreen
        onLogin={() => {
          sessionStorage.setItem(ADMIN_SESSION_KEY, "true");
          setIsAdminAuthenticated(true);
        }}
      />
    );
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar-main">
          <div className="admin-logo">
            <span className="icon-18"><img className="svg-icon hospital-icon" src={hospitalIcon} alt="" /></span>
            <strong>{clinicSettings.name}</strong>
          </div>
          <nav className="admin-nav">
            <TapButton className={activeTab === "reservations" ? "active" : ""} onClick={() => switchAdminTab("reservations")}>
              예약 현황
            </TapButton>
            <TapButton className={activeTab === "settings" ? "active" : ""} onClick={() => switchAdminTab("settings")}>
              설정
            </TapButton>
          </nav>
        </div>
        <TapButton
          className="admin-logout-button"
          onClick={() => {
            sessionStorage.removeItem(ADMIN_SESSION_KEY);
            setIsAdminAuthenticated(false);
          }}
        >
          <img className="svg-icon" src={adminLogoutIcon} alt="" />
          로그아웃
        </TapButton>
      </aside>
      {activeTab === "reservations" ? (
        <>
          <AdminReservationList
            bookings={bookings}
            selectedDate={selectedDate}
            slots={displaySlots}
            treatmentLabels={treatmentLabels}
            onAdd={setEditingSlot}
            onUpdateReservation={(id, updates) =>
              appointmentStore.updateReservation(id, updates).catch((error) => {
                console.error("Failed to update reservation", error);
                setToast(getReservationErrorMessage(error));
              })
            }
          />
          <AdminCalendarPanel
            selectedDate={selectedDate}
            viewDate={viewDate}
            openDays={clinicSettings.openDays}
            daySettings={daySettings}
            daySetting={selectedDaySetting}
            onSelectDate={(date) => {
              setSelectedDate(date);
              setViewDate(new Date(date.getFullYear(), date.getMonth(), 1));
            }}
            onMoveMonth={(offset) => setViewDate((date) => new Date(date.getFullYear(), date.getMonth() + offset, 1))}
            onSaveDaySetting={(setting) =>
              appointmentStore.saveDaySetting(setting).then(() => setToast("오늘 운영 설정을 저장했어요")).catch((error) => setToast(getReservationErrorMessage(error)))
            }
          />
        </>
      ) : (
        <AdminSettingsPanel
          clinicSettings={clinicSettings}
          slots={baseSlots}
          treatmentOptions={treatmentOptions}
          waitRules={waitRules}
          onSaveClinic={(settings) =>
            appointmentStore.saveClinicSettings(settings).then(() => setToast("설정을 저장했어요")).catch((error) => setToast(getReservationErrorMessage(error)))
          }
          onSaveCapacity={(capacity) =>
            Promise.all(
              baseSlots.map((slot, index) =>
                appointmentStore.saveSlot({ ...slot, remaining: capacity, closed: false }, (index + 1) * 10),
              ),
            ).then(() => setToast("예약 가능 인원을 저장했어요")).catch((error) => setToast(getReservationErrorMessage(error)))
          }
          onSaveWaitInterval={(minutes) =>
            appointmentStore.saveWaitInterval(baseSlots, minutes).then(() => setToast("대기 시간 규칙을 저장했어요")).catch((error) => setToast(getReservationErrorMessage(error)))
          }
          onSaveTreatments={(options) =>
            appointmentStore.saveTreatments(options).then(() => setToast("진료 과목을 저장했어요")).catch((error) => setToast(getReservationErrorMessage(error)))
          }
        />
      )}
      <AnimatePresence>
        {editingSlot && (
          <AdminAddReservationModal
            selectedDate={selectedDate}
            slot={editingSlot}
            bookings={bookings}
            treatmentLabels={treatmentLabels}
            waitRules={waitRules}
            onClose={() => setEditingSlot(null)}
            onCreate={(booking) =>
              appointmentStore.create(booking)
                .then(() => {
                  setEditingSlot(null);
                  setToast("예약을 추가했어요");
                })
                .catch((error) => {
                  console.error("Failed to create admin reservation", error);
                  setToast(getReservationErrorMessage(error));
                })
            }
          />
        )}
      </AnimatePresence>
      <Toast message={toast} onDismiss={() => setToast("")} />
    </main>
  );

  function switchAdminTab(tab: "reservations" | "settings") {
    setActiveTab(tab);
    window.history.replaceState(null, "", tab === "settings" ? "/admin/settings" : "/admin");
  }
}

function AdminReservationList({
  bookings,
  selectedDate,
  slots,
  treatmentLabels,
  onAdd,
  onUpdateReservation,
}: {
  bookings: Booking[];
  selectedDate: Date;
  slots: Slot[];
  treatmentLabels: Treatment[];
  onAdd: (slot: Slot) => void;
  onUpdateReservation: (id: string, updates: Partial<Pick<Booking, "patientName" | "treatment" | "status" | "cancelReason">>) => void;
}) {
  const dateKey = toDateKey(selectedDate);
  const visibleSlots = getVisibleSlotsForDate(slots, selectedDate);
  const morning = visibleSlots.filter((slot) => Number(slot.time.split(":")[0]) < 13);
  const afternoon = visibleSlots.filter((slot) => Number(slot.time.split(":")[0]) >= 13);

  return (
    <section className="admin-reservations">
      <h1>예약 현황</h1>
      <AdminSlotSection
        title="오전"
        dateKey={dateKey}
        bookings={bookings}
        slots={morning}
        treatmentLabels={treatmentLabels}
        onAdd={onAdd}
        onUpdateReservation={onUpdateReservation}
      />
      <AdminSlotSection
        title="오후"
        dateKey={dateKey}
        bookings={bookings}
        slots={afternoon}
        treatmentLabels={treatmentLabels}
        onAdd={onAdd}
        onUpdateReservation={onUpdateReservation}
      />
    </section>
  );
}

function AdminSlotSection(props: {
  title: string;
  dateKey: string;
  bookings: Booking[];
  slots: Slot[];
  treatmentLabels: Treatment[];
  onAdd: (slot: Slot) => void;
  onUpdateReservation: (id: string, updates: Partial<Pick<Booking, "patientName" | "treatment" | "status" | "cancelReason">>) => void;
}) {
  if (!props.slots.length) return null;

  return (
    <div className="admin-slot-section">
      <p>{props.title}</p>
      {props.slots.map((slot) => {
        const slotBookings = props.bookings
          .filter((booking) => booking.date === props.dateKey && booking.time === slot.time)
          .sort((a, b) => compareBookingsByCreatedAt(a, b));
        const confirmedCount = slotBookings.filter((booking) => booking.status === "confirmed").length;

        return (
          <article className="admin-time-card" key={slot.id}>
            <header>
              <span>
                <strong>{slot.time}</strong>
                <em className={confirmedCount === 0 ? "empty" : undefined}>{confirmedCount}</em>
              </span>
              <TapButton className="admin-add-button" onClick={() => props.onAdd(slot)}>
                <span aria-hidden="true">+</span>
                추가
              </TapButton>
            </header>
            {slotBookings.map((booking) => (
              <div className={`admin-reservation-row ${booking.status === "cancelled" ? "cancelled" : ""}`} key={booking.id}>
                <AdminStatusSelect booking={booking} onUpdate={(updates) => props.onUpdateReservation(booking.id, updates)} />
                <span className="admin-patient-name">{booking.patientName}</span>
                <span className="admin-treatment-value">{booking.treatment}</span>
                {booking.status === "cancelled" && <span className="admin-cancel-reason">{booking.cancelReason || "관리자 취소"}</span>}
              </div>
            ))}
          </article>
        );
      })}
    </div>
  );
}

function AdminCalendarPanel(props: {
  selectedDate: Date;
  viewDate: Date;
  openDays: number;
  daySettings: DaySetting[];
  daySetting?: DaySetting;
  onSelectDate: (date: Date) => void;
  onMoveMonth: (offset: number) => void;
  onSaveDaySetting: (setting: DaySetting) => void;
}) {
  const days = useMemo(() => makeCalendarDays(props.viewDate), [props.viewDate]);
  const dateKey = toDateKey(props.selectedDate);
  const defaultOpen = isDefaultOpenBookingDate(props.selectedDate, props.openDays);
  const defaultClinicDay = isDefaultClinicDay(props.selectedDate);
  const isClinicDay = props.daySetting ? !props.daySetting.isClosed : defaultClinicDay;
  const isOpen = props.daySetting?.isOpen ?? (isClinicDay && defaultOpen);

  return (
    <aside className="admin-side-panel">
      <div className="admin-calendar">
        <div className="admin-month-control">
          <TapButton onClick={() => props.onMoveMonth(-1)} aria-label="이전 달">
            <img className="svg-icon month-arrow" src={monthPrevIcon} alt="" />
          </TapButton>
          <strong>{props.viewDate.getFullYear()}년 {props.viewDate.getMonth() + 1}월</strong>
          <TapButton onClick={() => props.onMoveMonth(1)} aria-label="다음 달">
            <img className="svg-icon month-arrow" src={monthNextIcon} alt="" />
          </TapButton>
        </div>
        <div className="admin-calendar-grid weekdays">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
        <div className="admin-calendar-grid">
          {days.map((date, index) => {
            const isPicked = date ? sameDay(date, props.selectedDate) : false;
            const dayStatus = date ? getAdminCalendarDayStatus(date, props.openDays, props.daySettings) : "open";
            return (
              <TapButton
                key={date ? date.toISOString() : `admin-empty-${index}`}
                className={[isPicked ? "picked" : "", dayStatus === "closed" ? "closed" : "", dayStatus === "unopened" ? "unopened" : ""].filter(Boolean).join(" ")}
                disabled={!date}
                onClick={() => date && props.onSelectDate(date)}
              >
                {date?.getDate()}
              </TapButton>
            );
          })}
        </div>
      </div>
      <div className="admin-divider" />
      <div className="admin-toggle-row">
        <span>진료일</span>
        <AdminSwitch
          label="진료일"
          checked={isClinicDay}
          onChange={(checked) =>
            props.onSaveDaySetting({
              date: dateKey,
              isClosed: !checked,
              isOpen: checked ? (props.daySetting?.isOpen ?? defaultOpen) : false,
            })
          }
        />
      </div>
      <div className="admin-toggle-row">
        <span>예약 오픈</span>
        <AdminSwitch
          label="예약 오픈"
          checked={isClinicDay && isOpen}
          onChange={(checked) => props.onSaveDaySetting({ date: dateKey, isClosed: checked ? false : !isClinicDay, isOpen: checked })}
        />
      </div>
    </aside>
  );
}

function AdminSettingsPanel(props: {
  clinicSettings: ClinicSettings;
  slots: Slot[];
  treatmentOptions: TreatmentOption[];
  waitRules: WaitRule[];
  onSaveClinic: (settings: ClinicSettings) => void;
  onSaveCapacity: (capacity: number) => void;
  onSaveWaitInterval: (minutes: number) => void;
  onSaveTreatments: (options: TreatmentOption[]) => void;
}) {
  const [clinicDraft, setClinicDraft] = useState(props.clinicSettings);
  const [capacity, setCapacity] = useState(getCommonCapacity(props.slots));
  const [waitInterval, setWaitInterval] = useState(getWaitInterval(props.waitRules));
  const [isClinicEditOpen, setIsClinicEditOpen] = useState(false);
  const [isTreatmentAddOpen, setIsTreatmentAddOpen] = useState(false);

  useEffect(() => setClinicDraft(props.clinicSettings), [props.clinicSettings]);
  useEffect(() => setCapacity(getCommonCapacity(props.slots)), [props.slots]);
  useEffect(() => setWaitInterval(getWaitInterval(props.waitRules)), [props.waitRules]);

  const visibleTreatments = props.treatmentOptions.filter((option) => option.isOpen);

  return (
    <section className="admin-settings">
      <h1>설정</h1>
      <div className="admin-settings-stack">
        <article className="admin-setting-card">
          <h2>병원 정보</h2>
          <AdminSettingValueRow label="병원 이름" value={props.clinicSettings.name} action={<AdminEditChip onClick={() => setIsClinicEditOpen(true)} />} />
          <AdminSettingValueRow label="전화번호" value={props.clinicSettings.phone} action={<AdminEditChip onClick={() => setIsClinicEditOpen(true)} />} />
        </article>
        <article className="admin-setting-card">
          <h2>예약 가능일</h2>
          <AdminSettingValueRow
            label="오늘로부터"
            action={
              <AdminStepper
                value={`${props.clinicSettings.openDays}일 후까지`}
                onDecrease={() => props.onSaveClinic({ ...props.clinicSettings, openDays: Math.max(1, props.clinicSettings.openDays - 1) })}
                onIncrease={() => props.onSaveClinic({ ...props.clinicSettings, openDays: props.clinicSettings.openDays + 1 })}
              />
            }
          />
        </article>
        <article className="admin-setting-card">
          <h2>예약 시간</h2>
          <AdminSettingValueRow
            label="시간 당 예약 가능 인원"
            action={
              <AdminStepper
                value={`${capacity}명`}
                onDecrease={() => {
                  const next = Math.max(1, capacity - 1);
                  setCapacity(next);
                  props.onSaveCapacity(next);
                }}
                onIncrease={() => {
                  const next = capacity + 1;
                  setCapacity(next);
                  props.onSaveCapacity(next);
                }}
              />
            }
          />
          <AdminSettingValueRow
            label="순번 별 예상 대기 시간"
            action={
              <AdminStepper
                value={`${waitInterval}분`}
                onDecrease={() => {
                  const next = Math.max(0, waitInterval - 5);
                  setWaitInterval(next);
                  props.onSaveWaitInterval(next);
                }}
                onIncrease={() => {
                  const next = waitInterval + 5;
                  setWaitInterval(next);
                  props.onSaveWaitInterval(next);
                }}
              />
            }
          />
        </article>
        <article className="admin-setting-card">
          <header>
            <h2>진료 과목</h2>
            <TapButton className="admin-add-text-button" onClick={() => setIsTreatmentAddOpen(true)}>
              <img className="svg-icon" src={adminPlusIcon} alt="" />
              추가
            </TapButton>
          </header>
          <div className="admin-chip-list">
            {visibleTreatments.map((option) => (
              <TapButton
                className="admin-chip"
                key={option.id}
                onClick={() => props.onSaveTreatments(props.treatmentOptions.map((item) => item.id === option.id ? { ...item, isOpen: false } : item))}
              >
                {option.label}
                <img className="svg-icon" src={adminChipCloseIcon} alt="" />
              </TapButton>
            ))}
          </div>
        </article>
      </div>
      <AnimatePresence>
        {isClinicEditOpen && (
          <AdminClinicEditModal
            initialSettings={clinicDraft}
            onClose={() => setIsClinicEditOpen(false)}
            onSave={(settings) => {
              setClinicDraft(settings);
              props.onSaveClinic(settings);
              setIsClinicEditOpen(false);
            }}
          />
        )}
        {isTreatmentAddOpen && (
          <AdminTreatmentAddModal
            onClose={() => setIsTreatmentAddOpen(false)}
            onSave={(label) => {
              props.onSaveTreatments([
                ...visibleTreatments,
                { id: makeTreatmentId(label), label, isOpen: true, sortOrder: visibleTreatments.length * 10 },
              ]);
              setIsTreatmentAddOpen(false);
            }}
          />
        )}
      </AnimatePresence>
    </section>
  );
}

function AdminSettingValueRow({ label, value, action }: { label: string; value?: string; action?: React.ReactNode }) {
  return (
    <div className="admin-setting-row">
      <span>{label}</span>
      <div>
        {value && <strong>{value}</strong>}
        {action}
      </div>
    </div>
  );
}

function AdminEditChip({ onClick }: { onClick: () => void }) {
  return (
    <TapButton className="admin-edit-chip" onClick={onClick}>
      편집
    </TapButton>
  );
}

function AdminStepper({ value, onDecrease, onIncrease }: { value: string; onDecrease: () => void; onIncrease: () => void }) {
  return (
    <div className="admin-stepper">
      <TapButton onClick={onDecrease} aria-label="줄이기">
        <img className="svg-icon" src={adminMinusIcon} alt="" />
      </TapButton>
      <strong>{value}</strong>
      <TapButton onClick={onIncrease} aria-label="늘리기">
        <img className="svg-icon" src={adminPlusIcon} alt="" />
      </TapButton>
    </div>
  );
}

function AdminLoginScreen({ onLogin }: { onLogin: () => void }) {
  const [password, setPassword] = useState("");
  const [hasError, setHasError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submitPassword() {
    setIsSubmitting(true);
    const isValid = await verifyAdminPassword(password);
    setIsSubmitting(false);

    if (isValid) {
      onLogin();
      return;
    }

    setHasError(true);
  }

  return (
    <main className="admin-login-shell">
      <motion.section
        className="admin-login-card"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={overlaySpring}
      >
        <div className="admin-login-logo">
          <span className="icon-18"><img className="svg-icon hospital-icon" src={hospitalIcon} alt="" /></span>
          <strong>이목구비 김한의원</strong>
        </div>
        <h1>
          관리자 로그인
          <br />
          비밀번호를 입력해주세요
        </h1>
        <div className="admin-login-field">
          <input
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              setHasError(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitPassword();
            }}
            type="password"
            placeholder="비밀번호 입력"
            autoFocus
          />
          {hasError && <p>비밀번호가 틀렸어요</p>}
        </div>
        <TapButton className="admin-login-submit" disabled={isSubmitting} onClick={() => void submitPassword()}>
          {isSubmitting ? "확인 중" : "로그인"}
        </TapButton>
      </motion.section>
    </main>
  );
}

function AdminClinicEditModal({
  initialSettings,
  onClose,
  onSave,
}: {
  initialSettings: ClinicSettings;
  onClose: () => void;
  onSave: (settings: ClinicSettings) => void;
}) {
  const [draft, setDraft] = useState(initialSettings);

  return (
    <motion.div className="admin-modal-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={overlaySpring} onClick={onClose}>
      <motion.section className="admin-modal admin-edit-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={overlaySpring} onClick={(event) => event.stopPropagation()}>
        <h1>병원 정보</h1>
        <label>
          <span>병원 이름</span>
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
        </label>
        <label>
          <span>전화번호</span>
          <input value={draft.phone} onChange={(event) => setDraft({ ...draft, phone: event.target.value })} />
        </label>
        <TapButton className="admin-primary-button" onClick={() => onSave(draft)}>저장하기</TapButton>
      </motion.section>
    </motion.div>
  );
}

function AdminTreatmentAddModal({ onClose, onSave }: { onClose: () => void; onSave: (label: string) => void }) {
  const [label, setLabel] = useState("");

  return (
    <motion.div className="admin-modal-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={overlaySpring} onClick={onClose}>
      <motion.section className="admin-modal admin-edit-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={overlaySpring} onClick={(event) => event.stopPropagation()}>
        <h1>진료 과목 추가</h1>
        <label>
          <span>진료 과목</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="예: 추나요법" autoFocus />
        </label>
        <TapButton className="admin-primary-button" disabled={!label.trim()} onClick={() => onSave(label.trim())}>추가하기</TapButton>
      </motion.section>
    </motion.div>
  );
}

function AdminSlotsEditModal({
  slots,
  onClose,
  onSave,
}: {
  slots: Slot[];
  onClose: () => void;
  onSave: (slots: Slot[]) => void;
}) {
  const [draftSlots, setDraftSlots] = useState(slots);

  return (
    <motion.div className="admin-modal-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={overlaySpring} onClick={onClose}>
      <motion.section className="admin-modal admin-edit-modal" initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} transition={overlaySpring} onClick={(event) => event.stopPropagation()}>
        <h1>예약 시간</h1>
        <div className="admin-slot-edit-list">
          {draftSlots.map((slot, index) => (
            <label key={slot.id}>
              <span>{Number(slot.time.split(":")[0]) < 13 ? "오전" : "오후"}</span>
              <input
                type="time"
                value={toTimeInputValue(slot.time)}
                onChange={(event) =>
                  setDraftSlots((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, time: formatTimeInputValue(event.target.value) } : item,
                    ),
                  )
                }
              />
              <input
                type="checkbox"
                checked={!slot.closed}
                onChange={(event) =>
                  setDraftSlots((items) =>
                    items.map((item, itemIndex) =>
                      itemIndex === index ? { ...item, closed: !event.target.checked } : item,
                    ),
                  )
                }
              />
            </label>
          ))}
        </div>
        <TapButton className="admin-primary-button" onClick={() => onSave(draftSlots)}>저장하기</TapButton>
      </motion.section>
    </motion.div>
  );
}

function AdminAddReservationModal(props: {
  selectedDate: Date;
  slot: Slot;
  bookings: Booking[];
  treatmentLabels: Treatment[];
  waitRules: WaitRule[];
  onClose: () => void;
  onCreate: (booking: Booking) => void;
}) {
  const [patientName, setPatientName] = useState("");
  const [treatment, setTreatment] = useState<Treatment>(props.treatmentLabels[0] ?? "없음");
  const canCreate = patientName.trim().length > 0;
  const waitMinutes = getWaitMinutesForNextReservation(props.slot, props.selectedDate, props.bookings, props.waitRules);

  return (
    <motion.div className="admin-modal-dim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={overlaySpring} onClick={props.onClose}>
      <motion.section
        className="admin-modal admin-add-modal"
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={overlaySpring}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="admin-add-modal-fields">
          <h1>진료 추가하기</h1>
          <div className="admin-add-modal-form">
            <label>
              <span>이름</span>
              <input value={patientName} onChange={(event) => setPatientName(event.target.value)} placeholder="이름 입력" autoFocus />
            </label>
            <section>
              <span>진료 과목</span>
              <div className="admin-treatment-segment">
                {props.treatmentLabels.map((label) => {
                  const selected = treatment === label;
                  return (
                    <TapButton className={selected ? "selected" : ""} key={label} onClick={() => setTreatment(label)}>
                      {label}
                      <img className="svg-icon" src={selected ? adminRadioSelectedIcon : adminRadioEmptyIcon} alt="" />
                    </TapButton>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
        <TapButton
          className="admin-primary-button"
          disabled={!canCreate}
          onClick={() =>
            props.onCreate({
              id: crypto.randomUUID(),
              patientName: patientName.trim(),
              date: toDateKey(props.selectedDate),
              time: props.slot.time,
              treatment,
              waitMinutes,
              status: "confirmed",
              createdAt: new Date().toISOString(),
            })
          }
        >
          추가하기
        </TapButton>
      </motion.section>
    </motion.div>
  );
}

function applyBookingsToSlots(slots: Slot[], selectedDate: Date, bookings: Booking[], forceClosed = false) {
  const dateKey = toDateKey(selectedDate);
  const visibleSlots = getVisibleSlotsForDate(slots, selectedDate);

  return visibleSlots.map((slot) => {
    const confirmedCount = bookings.filter(
      (item) => item.status === "confirmed" && item.date === dateKey && item.time === slot.time,
    ).length;
    const remaining = Math.max(0, slot.remaining - confirmedCount);

    return {
      ...slot,
      remaining,
      closed: forceClosed || slot.closed || remaining <= 0,
    };
  });
}

function getVisibleSlotsForDate(slots: Slot[], selectedDate: Date) {
  if (!isSaturday(selectedDate)) return slots;
  return slots.filter((slot) => Number(slot.time.split(":")[0]) < 13);
}

function toReservationRow(booking: Booking) {
  return {
    id: booking.id,
    patient_name: booking.patientName,
    appointment_date: booking.date,
    appointment_time: booking.time,
    treatment: booking.treatment,
    wait_minutes: booking.waitMinutes,
    status: booking.status,
    cancel_reason: booking.cancelReason,
  };
}

function fromReservationRow(row: ReservationRow): Booking {
  return {
    id: row.id,
    patientName: row.patient_name,
    date: row.appointment_date,
    time: row.appointment_time,
    treatment: row.treatment,
    waitMinutes: row.wait_minutes,
    status: row.status,
    cancelReason: row.cancel_reason ?? "",
    createdAt: row.created_at,
  };
}

function compareBookingsByCreatedAt(a: Booking, b: Booking) {
  const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
  const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
  return aTime - bTime || a.id.localeCompare(b.id);
}

function fromTimeBlockRow(row: TimeBlockRow): Slot {
  return {
    id: row.id,
    time: row.time_label,
    remaining: row.capacity,
    closed: !row.is_open || row.capacity <= 0,
  };
}

function fromWaitRuleRow(row: WaitRuleRow): WaitRule {
  return {
    timeBlockId: row.time_block_id,
    reservationOrder: row.reservation_order,
    waitMinutes: row.wait_minutes,
  };
}

function fromClinicSettingsRow(row: ClinicSettingsRow): ClinicSettings {
  return {
    name: row.clinic_name,
    status: "오늘 진료중",
    phone: row.phone,
    openDays: row.open_days,
  };
}

function fromDaySettingRow(row: DaySettingRow): DaySetting {
  return {
    date: row.target_date,
    isClosed: row.is_closed,
    isOpen: row.is_open,
  };
}

function fromTreatmentOptionRow(row: TreatmentOptionRow): TreatmentOption {
  return {
    id: row.id,
    label: row.label,
    isOpen: row.is_open,
    sortOrder: row.sort_order,
  };
}

function getWaitMinutesForNextReservation(slot: Slot, selectedDate: Date, bookings: Booking[], waitRules: WaitRule[]) {
  const dateKey = toDateKey(selectedDate);
  const reservationOrder =
    bookings.filter((item) => item.status === "confirmed" && item.date === dateKey && item.time === slot.time).length + 1;

  return reservationOrder * getWaitIntervalForSlot(slot.id, waitRules);
}

function getReservationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("환경변수")) return message;
  if (message.includes("schema cache") || message.includes("Could not find the table")) return "Supabase SQL을 먼저 실행해주세요";
  if (message.includes("row-level security") || message.includes("RLS")) return "Supabase RLS 설정을 확인해주세요";
  if (message.includes("reservations")) return "예약 테이블을 확인해주세요";
  if (message.includes("Failed to fetch")) return "Supabase 연결을 확인해주세요";

  return "예약 저장에 실패했어요";
}

function isMissingOptionalTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message || error || "");
  return message.includes("schema cache") || message.includes("Could not find the table");
}

function makeCalendarDays(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const last = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  const mondayIndex = (first.getDay() + 6) % 7;
  const days: (Date | null)[] = Array.from({ length: mondayIndex }, () => null);
  for (let day = 1; day <= last.getDate(); day += 1) {
    days.push(new Date(date.getFullYear(), date.getMonth(), day));
  }
  while (days.length % 7 !== 0) days.push(null);
  return days;
}

function loadActiveBooking() {
  try {
    const raw = window.localStorage.getItem(activeBookingStorageKey);
    if (!raw) return null;

    const booking = JSON.parse(raw) as Booking;
    if (!isValidStoredBooking(booking) || isBookingExpired(booking)) {
      clearActiveBooking();
      return null;
    }

    return booking;
  } catch {
    clearActiveBooking();
    return null;
  }
}

function saveActiveBooking(booking: Booking) {
  window.localStorage.setItem(activeBookingStorageKey, JSON.stringify(booking));
}

function clearActiveBooking() {
  window.localStorage.removeItem(activeBookingStorageKey);
}

function isValidStoredBooking(booking: Partial<Booking>) {
  return Boolean(
    booking.id &&
      booking.patientName &&
      booking.date &&
      booking.time &&
      booking.treatment &&
      booking.status === "confirmed",
  );
}

function isBookingExpired(booking: Booking) {
  const expiresAt = getAppointmentDateTime(booking).getTime() + 60 * 60 * 1000;
  return Date.now() >= expiresAt;
}

function getAppointmentDateTime(booking: Pick<Booking, "date" | "time">) {
  const date = parseBookingDate(booking.date);
  const [hours, minutes] = booking.time.split(":").map(Number);
  date.setHours(hours, minutes || 0, 0, 0);
  return date;
}

function parseBookingDate(dateValue: string) {
  const [year, month, day] = dateValue.split("-").map(Number);
  if (year && month && day) return new Date(year, month - 1, day);

  const fallback = new Date(dateValue);
  return new Date(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getSlotIdByTime(time: string) {
  return initialSlots.find((slot) => slot.time === time)?.id ?? "1400";
}

function formatMonthDayWeek(date: Date) {
  const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
  return `${date.getMonth() + 1}월 ${date.getDate()}일 (${weekdays[date.getDay()]})`;
}

function formatShortDate(date: Date) {
  return formatMonthDayWeek(date);
}

function getRelativeDateLabel(date: Date) {
  const base = getToday();
  const tomorrow = new Date(base);
  tomorrow.setDate(base.getDate() + 1);

  if (sameDay(date, base)) return "오늘";
  if (sameDay(date, tomorrow)) return "내일";
  return "";
}

function isSelectableBookingDate(date: Date, openDays: number) {
  const today = getToday();
  const lastOpenDate = new Date(today);
  lastOpenDate.setDate(today.getDate() + Math.max(1, openDays) - 1);
  const time = startOfDay(date).getTime();
  return time >= today.getTime() && time <= lastOpenDate.getTime();
}

function isDefaultOpenBookingDate(date: Date, openDays: number) {
  return isSelectableBookingDate(date, openDays) && isDefaultClinicDay(date);
}

function isDefaultClinicDay(date: Date) {
  return date.getDay() !== 0;
}

function toPhoneHref(phone: string) {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

function getCommonCapacity(slots: Slot[]) {
  if (!slots.length) return 5;
  return slots[0].remaining;
}

function getWaitInterval(waitRules: WaitRule[]) {
  const firstSlotId = waitRules[0]?.timeBlockId;
  if (!firstSlotId) return 15;
  return getWaitIntervalForSlot(firstSlotId, waitRules);
}

function getWaitIntervalForSlot(slotId: string, waitRules: WaitRule[]) {
  const rulesForSlot = waitRules
    .filter((rule) => rule.timeBlockId === slotId)
    .sort((a, b) => a.reservationOrder - b.reservationOrder);
  const firstRule = rulesForSlot.find((rule) => rule.reservationOrder === 1);
  const secondRule = rulesForSlot.find((rule) => rule.reservationOrder === 2);
  const intervalFromDifference = firstRule && secondRule ? secondRule.waitMinutes - firstRule.waitMinutes : 0;

  if (intervalFromDifference > 0) return intervalFromDifference;
  if (firstRule && firstRule.waitMinutes > 0) return firstRule.waitMinutes;
  if (secondRule && secondRule.waitMinutes > 0) return secondRule.waitMinutes;
  return 15;
}

async function verifyAdminPassword(password: string) {
  if (import.meta.env.DEV) return password === "3359799@";

  try {
    const response = await fetch("/api/admin-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });

    if (!response.ok) return false;
    const result = await response.json();
    return result.ok === true;
  } catch (error) {
    console.error("Failed to verify admin password", error);
    return false;
  }
}

function makeTreatmentId(label: string) {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || crypto.randomUUID();
}

function getDaySetting(daySettings: DaySetting[], date: Date) {
  const dateKey = toDateKey(date);
  return daySettings.find((setting) => setting.date === dateKey);
}

function isAdminOpenDate(date: Date, openDays: number, daySettings: DaySetting[]) {
  const daySetting = getDaySetting(daySettings, date);
  if (daySetting?.isClosed) return false;
  return daySetting?.isOpen ?? isDefaultOpenBookingDate(date, openDays);
}

function getAdminCalendarDayStatus(date: Date, openDays: number, daySettings: DaySetting[]) {
  const daySetting = getDaySetting(daySettings, date);
  const defaultClinicDay = isDefaultClinicDay(date);
  const isClinicDay = daySetting ? !daySetting.isClosed : defaultClinicDay;

  if (!isClinicDay) return "closed";
  if (daySetting?.isOpen) return "open";
  if (daySetting?.isOpen === false) return "unopened";
  if (!isSelectableBookingDate(date, openDays)) return "unopened";
  return "open";
}

function toTimeInputValue(time: string) {
  const [hours, minutes = "00"] = time.split(":");
  return `${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
}

function formatTimeInputValue(time: string) {
  const [hours, minutes = "00"] = time.split(":");
  return `${Number(hours)}:${minutes.padStart(2, "0")}`;
}

function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isPastDate(date: Date) {
  return startOfDay(date).getTime() < getToday().getTime();
}

function isSaturday(date: Date) {
  return date.getDay() === 6;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const isAdminRoute = window.location.pathname.startsWith("/admin");
document.body.classList.toggle("admin-page", isAdminRoute);

createRoot(document.getElementById("root")!).render(isAdminRoute ? <AdminApp /> : <App />);
