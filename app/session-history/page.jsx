// app/session-history/page.jsx
"use client";

import {
  ChevronLeft,
  Clock,
  CheckCircle,
  X,
  TimerOff,
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/app/config/firebase";
import { collection, query, where, getDocs, orderBy } from "firebase/firestore";

// --- Helper Functions ---

const formatDate = (date) => {
  if (!date) return "N/A";
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  const options = { month: "short", day: "numeric", year: "numeric" };
  return d.toLocaleDateString("en-US", options);
};

const formatTime = (totalSeconds) => {
  if (!totalSeconds) return "0:00";
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes < 10 ? "0" : ""}${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  }
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
};

const formatModalDate = (date) => {
  if (!date) return "N/A";
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  const options = {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
  };
  return d.toLocaleDateString("en-US", options);
};

const getActionDetails = (action) => {
  switch (action) {
    case "ended_with_time_saved":
      return {
        label: "Ended & Saved",
        icon: CheckCircle,
        colorClass: "text-green-500",
        bgColorClass: "bg-green-100",
      };
    case "expired":
      return {
        label: "Expired",
        icon: TimerOff,
        colorClass: "text-orange-500",
        bgColorClass: "bg-orange-100",
      };
    case "manually_stopped":
      return {
        label: "Manually Stopped",
        icon: X,
        colorClass: "text-red-500",
        bgColorClass: "bg-red-100",
      };
    default:
      return {
        label: "Ended",
        icon: Clock,
        colorClass: "text-gray-500",
        bgColorClass: "bg-gray-100",
      };
  }
};

// --- Grouping Logic ---
const groupSessions = (sessions) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const last7DaysStart = new Date(todayStart.getTime() - 7 * 86400000);

  const todaySessions = [];
  const yesterdaySessions = [];
  const last7DaysSessions = [];

  sessions.forEach((session) => {
    const sessionDate = session.sessionEndTime?.toDate ? session.sessionEndTime.toDate() : new Date(session.sessionEndTime);
    if (sessionDate >= todayStart) {
      todaySessions.push(session);
    } else if (sessionDate >= yesterdayStart) {
      yesterdaySessions.push(session);
    } else if (sessionDate >= last7DaysStart) {
      last7DaysSessions.push(session);
    }
  });

  return { todaySessions, yesterdaySessions, last7DaysSessions };
};

// =================================================================
// 🖥️ SESSION HISTORY PAGE COMPONENT START
// =================================================================
function SessionHistoryContent() {
  const searchParams = useSearchParams();
  const rfidFromUrl = searchParams.get("rfid");
  
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSession, setSelectedSession] = useState(null);

  useEffect(() => {
    const fetchSessionHistory = async () => {
      if (!rfidFromUrl) {
        setLoading(false);
        return;
      }

      try {
        // Query session history - try ordering by timestamp, fallback to createdAt
        let q;
        try {
          q = query(
            collection(db, "session_history"),
            where("userId", "==", rfidFromUrl),
            orderBy("timestamp", "desc")
          );
          await getDocs(q); // Test if query works
        } catch (orderError) {
          // Fallback: order by sessionEndTime or createdAt
          try {
            q = query(
              collection(db, "session_history"),
              where("userId", "==", rfidFromUrl),
              orderBy("sessionEndTime", "desc")
            );
            await getDocs(q); // Test if query works
          } catch (orderError2) {
            q = query(
              collection(db, "session_history"),
              where("userId", "==", rfidFromUrl),
              orderBy("createdAt", "desc")
            );
          }
        }

        const querySnapshot = await getDocs(q);
        const sessionList = [];
        
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          sessionList.push({
            id: doc.id,
            ...data,
          });
        });

        setSessions(sessionList);
        console.log(`✅ Fetched ${sessionList.length} session(s)`);
      } catch (error) {
        console.error("Error fetching session history:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchSessionHistory();
  }, [rfidFromUrl]);

  // --- Helper Components (Defined inside the page) ---

  const NoSessionsEmptyState = () => (
    <div className="flex flex-col items-center justify-center p-6 gap-5 bg-white rounded-2xl border border-gray-300">
      <div className="bg-gray-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full">
        <Clock className="text-gray-500 size-6 sm:size-7" />
      </div>
      <div className="flex flex-col items-center justify-center gap-2">
        <div className="flex flex-col text-center">
          <span className="text-lg sm:text-xl font-semibold">
            No Session History
          </span>
          <span className="text-gray-500 text-xs sm:text-sm">
            There are no sessions recorded yet.
          </span>
        </div>
      </div>
    </div>
  );

  const SessionCard = ({ session, onClick }) => {
    const { label, icon: Icon, colorClass, bgColorClass } = getActionDetails(session.action);
    const sessionEndDate = session.sessionEndTime?.toDate ? session.sessionEndTime.toDate() : new Date(session.sessionEndTime);
    const dateString = formatDate(sessionEndDate);

    return (
      <div
        onClick={onClick}
        className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 cursor-pointer"
      >
        {/* left */}
        <div className="flex items-center gap-3">
          <div className={`flex items-center text-white rounded-full p-2 justify-center ${bgColorClass}`}>
            <Icon className={`size-5 ${colorClass}`} />
          </div>
          <div className="flex flex-col">
            <span className="font-semibold">{label}</span>
            <span className="text-sm text-gray-500">{dateString}</span>
            <span className="text-xs text-gray-400">
              Duration: {formatTime(session.durationSeconds)}
            </span>
          </div>
        </div>
        {/* right */}
        {session.savedForNextSession && session.timeRemainingMinutes > 0 && (
          <div className="flex items-center gap-1 text-green-600">
            <Clock className="size-4" />
            <span className="text-xs font-semibold">
              {session.timeRemainingMinutes}m saved
            </span>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
          <span className="text-gray-500">Loading session history...</span>
        </div>
      </div>
    );
  }

  const { todaySessions, yesterdaySessions, last7DaysSessions } = groupSessions(sessions);

  return (
    <div className="min-h-dvh flex justify-center text-sm sm:text-base sm:bg-white">
      <div className="flex flex-col gap-6 p-3 sm:p-4 md:px-0 w-full max-w-md">
        {/* Header */}
        <div className="relative flex items-center justify-center w-full pt-2">
          {/* left */}
          <Link
            href={`/dashboard?rfid=${encodeURIComponent(rfidFromUrl || "")}`}
            className="absolute left-0 rounded-full border border-gray-300/80 bg-white hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors duration-150 p-2"
          >
            <ChevronLeft className="size-4 sm:size-5" />
          </Link>
          <span className="text-base sm:text-lg font-semibold">Session History</span>
        </div>

        {/* Main */}
        <div className="flex flex-col gap-4">
          {/* Show empty state only if no sessions at all */}
          {sessions.length === 0 ? (
            <NoSessionsEmptyState />
          ) : (
            <>
              {/* Today's Sessions */}
              {todaySessions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm sm:text-base font-semibold">Today</span>
                  <div className="flex flex-col gap-2">
                    {todaySessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        onClick={() => setSelectedSession(session)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Yesterday's Sessions */}
              {yesterdaySessions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm sm:text-base font-semibold">
                    Yesterday
                  </span>
                  <div className="flex flex-col gap-2">
                    {yesterdaySessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        onClick={() => setSelectedSession(session)}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Last 7 Day Sessions */}
              {last7DaysSessions.length > 0 && (
                <div className="flex flex-col gap-2">
                  <span className="text-sm sm:text-base font-semibold">
                    Last 7 Days
                  </span>
                  <div className="flex flex-col gap-2">
                    {last7DaysSessions.map((session) => (
                      <SessionCard
                        key={session.id}
                        session={session}
                        onClick={() => setSelectedSession(session)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* --- Modal for Specific Session Details --- */}
      {selectedSession && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
            {(() => {
              const { label, icon: Icon, colorClass, bgColorClass } = getActionDetails(selectedSession.action);
              const startDate = selectedSession.sessionStartTime?.toDate ? selectedSession.sessionStartTime.toDate() : new Date(selectedSession.sessionStartTime);
              const endDate = selectedSession.sessionEndTime?.toDate ? selectedSession.sessionEndTime.toDate() : new Date(selectedSession.sessionEndTime);

              return (
                <>
                  <div className={`size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50 ${bgColorClass}`}>
                    <Icon className={`size-6 sm:size-7 ${colorClass}`} />
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2">
                    <div className="flex flex-col text-center">
                      <span className="text-base sm:text-lg font-semibold">
                        {label}
                      </span>
                      <span className="text-gray-500 text-xs sm:text-sm">
                        {formatModalDate(endDate)}
                      </span>
                    </div>
                  </div>
                  
                  {/* Details */}
                  <div className="flex flex-col gap-3 w-full">
                    <div className="flex w-full items-center justify-between rounded-lg p-4 bg-gray-100">
                      <div className="flex flex-col">
                        <span className="text-xs sm:text-sm font-semibold">Duration</span>
                        <span className="text-xs sm:text-sm text-gray-500">
                          {formatTime(selectedSession.durationSeconds)}
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs sm:text-sm font-semibold">Start Time</span>
                        <span className="text-xs sm:text-sm text-gray-500">
                          {formatModalDate(startDate)}
                        </span>
                      </div>
                    </div>

                    {selectedSession.savedForNextSession && selectedSession.timeRemainingMinutes > 0 && (
                      <div className="flex flex-col gap-1 p-3 bg-green-50 border border-green-200 rounded-lg">
                        <span className="text-xs font-semibold text-green-900">Time Saved</span>
                        <span className="text-sm text-green-800 font-mono">
                          {selectedSession.timeRemainingMinutes} minutes ({selectedSession.timeRemainingSeconds} seconds)
                        </span>
                        <span className="text-xs text-green-700 mt-1">
                          Saved date: {formatDate(selectedSession.savedTimeDate)}
                        </span>
                      </div>
                    )}

                    {selectedSession.amountDeducted && (
                      <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <span className="text-xs font-semibold text-blue-900">Amount Deducted</span>
                        <span className="text-sm text-blue-800 font-mono">
                          ₱{selectedSession.amountDeducted.toFixed(2)}
                        </span>
                        <span className="text-xs text-blue-700 mt-1">
                          Minutes used: {selectedSession.minutesUsed || Math.floor(selectedSession.durationSeconds / 60)}
                        </span>
                      </div>
                    )}

                    <div className="flex w-full items-center justify-between rounded-lg p-4 bg-gray-100">
                      <div className="flex flex-col">
                        <span className="text-xs sm:text-sm font-semibold">Session ID</span>
                        <span className="text-xs sm:text-sm text-gray-500 font-mono">
                          {selectedSession.id.substring(0, 8)}...
                        </span>
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs sm:text-sm font-semibold">User</span>
                        <span className="text-xs sm:text-sm text-gray-500">
                          {selectedSession.userName || "Unknown"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* close modal */}
                  <button
                    onClick={() => setSelectedSession(null)}
                    className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
                  >
                    Close
                  </button>
                </>
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SessionHistory() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
            <span className="text-gray-500">Loading session history...</span>
          </div>
        </div>
      }
    >
      <SessionHistoryContent />
    </Suspense>
  );
}

