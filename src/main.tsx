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

type Route = "time" | "details" | "complete";
type Treatment = "없음" | "침 치료" | "한약 처방";
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
};

type ReservationRow = {
  id: string;
  patient_name: string;
  appointment_date: string;
  appointment_time: string;
  treatment: Treatment;
  wait_minutes: number;
  status: "confirmed" | "cancelled";
};

type TimeBlockRow = {
  id: string;
  time_label: string;
  capacity: number;
  is_open: boolean;
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
  list(): Promise<Booking[]>;
  listSlots(): Promise<Slot[]>;
  listWaitRules(): Promise<WaitRule[]>;
};

const activeBookingStorageKey = "hospital-reservation.activeBooking";

const clinic = {
  name: "이목구비 김한의원",
  status: "오늘 진료중",
  phone: "tel:0553359799",
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

const treatments: Treatment[] = ["없음", "침 치료", "한약 처방"];
const cancelReasons = ["시간 변경", "단순 변심"];
const spring = { type: "spring" as const, stiffness: 420, damping: 36, mass: 0.9 };
const screenSpring = { type: "spring" as const, stiffness: 480, damping: 50 };
const snackbarSpring = { type: "spring" as const, stiffness: 480, damping: 50 };
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
    return () => this.listeners.delete(listener);
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
    const cancelled = { ...booking, status: "cancelled" as const };

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
      const { data, error } = await supabase.from("appointment_time_blocks").select("*").order("sort_order", { ascending: true });
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
  const [toast, setToast] = useState("");
  const [isCancelOpen, setIsCancelOpen] = useState(false);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [skipStackMotion, setSkipStackMotion] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const slots = useMemo(() => applyBookingsToSlots(baseSlots, selectedDate, bookings), [baseSlots, selectedDate, bookings]);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? slots.find((slot) => !slot.closed) ?? initialSlots[0];

  useEffect(() => {
    if (!selectedSlot.closed) return;
    const firstOpenSlot = slots.find((slot) => !slot.closed);
    if (firstOpenSlot) setSelectedSlotId(firstOpenSlot.id);
  }, [selectedSlot.closed, slots]);

  useEffect(() => {
    let isMounted = true;

    const loadAdminData = () => {
      void Promise.all([appointmentStore.list(), appointmentStore.listSlots(), appointmentStore.listWaitRules()])
        .then(([items, nextSlots, nextWaitRules]) => {
          if (!isMounted) return;
          setBookings(items);
          setBaseSlots(nextSlots);
          setWaitRules(nextWaitRules);
        })
        .catch(() => {
          if (!isMounted) return;
          setBookings([]);
          setBaseSlots(initialSlots);
          setWaitRules([]);
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
                  <CompleteScreen booking={booking} onCancel={() => setIsCancelOpen(true)} />
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
              isCancelling={isCancelling}
              onClose={() => setIsCancelOpen(false)}
              onSubmit={cancelBooking}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isCalendarOpen && (
            <CalendarSheet
              selectedDate={selectedDate}
              onClose={() => setIsCalendarOpen(false)}
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
  isCancelling,
  onClose,
  onSubmit,
}: {
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
      <CancelScreen onClose={onClose} onSubmit={onSubmit} />
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

function Header({ back, compact = false, complete = false }: { back?: () => void; compact?: boolean; complete?: boolean }) {
  if (complete) {
    return (
      <header className="topbar complete-topbar">
        <strong className="complete-header-title">{clinic.name}</strong>
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
          <strong>{clinic.name}</strong>
        </div>
      )}
      {back && <strong className="header-title">{clinic.name}</strong>}
      {!back && <span className="clinic-status">{clinic.status}</span>}
      {back && <span className="header-spacer" />}
    </header>
  );
}

function TimeScreen(props: {
  selectedDate: Date;
  selectedSlotId: string;
  slots: Slot[];
  onOpenCalendar: () => void;
  onSelectSlot: (slot: Slot) => void;
  onNext: () => void;
}) {
  const morning = props.slots.filter((slot) => Number(slot.time.split(":")[0]) < 13);
  const afternoon = props.slots.filter((slot) => Number(slot.time.split(":")[0]) >= 13);
  const selectedSlot = props.slots.find((slot) => slot.id === props.selectedSlotId) ?? props.slots.find((slot) => !slot.closed);
  const relativeDateLabel = getRelativeDateLabel(props.selectedDate);

  return (
    <>
      <Header />
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
      <Header back={props.onBack} compact />
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
            {treatments.map((item) => (
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

function CompleteScreen({ booking, onCancel }: { booking: Booking; onCancel: () => void }) {
  return (
    <>
      <Header complete />
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
        <a className="light-button" href={clinic.phone}>전화 문의</a>
      </div>
    </>
  );
}

function CancelHeader({ onClose }: { onClose: () => void }) {
  return (
    <header className="topbar centered">
      <TapButton className="icon-button close-button" onClick={onClose} aria-label="닫기">
        <img className="svg-icon close-icon" src={closeIcon} alt="" />
      </TapButton>
      <strong className="header-title">{clinic.name}</strong>
      <span className="header-spacer" />
    </header>
  );
}

function CancelScreen({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => void }) {
  const [reason, setReason] = useState("단순 변심");
  const [custom, setCustom] = useState("");
  const isCustomReason = reason === "직접 입력";
  const finalReason = isCustomReason ? custom.trim() || "직접 입력" : reason;

  return (
    <>
      <CancelHeader onClose={onClose} />
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

function CalendarSheet(props: { selectedDate: Date; onClose: () => void; onSelect: (date: Date) => void }) {
  const safeSelectedDate = isPastDate(props.selectedDate) ? getToday() : props.selectedDate;
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
          {days.map((date, index) => (
            <TapButton
              key={date ? date.toISOString() : `empty-${index}`}
              className={date && sameDay(date, focusedDate) ? "picked" : ""}
              disabled={!date || isPastDate(date)}
              onClick={() => date && setFocusedDate(date)}
            >
              {date?.getDate()}
            </TapButton>
          ))}
        </div>
        <BottomCTA inSheet onClick={() => props.onSelect(focusedDate)}>선택하기</BottomCTA>
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
    const nextFocusedDate = isPastDate(preferredDate) ? getToday() : preferredDate;

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
  const icon = message.includes("마감") ? snackbarAlertIcon : snackbarCheckIcon;

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

function applyBookingsToSlots(slots: Slot[], selectedDate: Date, bookings: Booking[]) {
  const dateKey = toDateKey(selectedDate);

  return slots.map((slot) => {
    const confirmedCount = bookings.filter(
      (item) => item.status === "confirmed" && item.date === dateKey && item.time === slot.time,
    ).length;
    const remaining = Math.max(0, slot.remaining - confirmedCount);

    return {
      ...slot,
      remaining,
      closed: slot.closed || remaining <= 0,
    };
  });
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
  };
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

function getWaitMinutesForNextReservation(slot: Slot, selectedDate: Date, bookings: Booking[], waitRules: WaitRule[]) {
  const dateKey = toDateKey(selectedDate);
  const reservationOrder =
    bookings.filter((item) => item.status === "confirmed" && item.date === dateKey && item.time === slot.time).length + 1;
  const rulesForSlot = waitRules
    .filter((rule) => rule.timeBlockId === slot.id)
    .sort((a, b) => a.reservationOrder - b.reservationOrder);
  const exactRule = rulesForSlot.find((rule) => rule.reservationOrder === reservationOrder);
  const previousRule = rulesForSlot.filter((rule) => rule.reservationOrder < reservationOrder).slice(-1)[0];

  return exactRule?.waitMinutes ?? previousRule?.waitMinutes ?? 15;
}

function getReservationErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");

  if (message.includes("환경변수")) return message;
  if (message.includes("row-level security") || message.includes("RLS")) return "Supabase RLS 설정을 확인해주세요";
  if (message.includes("reservations")) return "예약 테이블을 확인해주세요";
  if (message.includes("Failed to fetch")) return "Supabase 연결을 확인해주세요";

  return "예약 저장에 실패했어요";
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

function getToday() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function isPastDate(date: Date) {
  return startOfDay(date).getTime() < getToday().getTime();
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

createRoot(document.getElementById("root")!).render(<App />);
