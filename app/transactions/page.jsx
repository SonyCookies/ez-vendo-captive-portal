// app/transactions/page.jsx
"use client";

import {
  ChevronLeft,
  ScrollText,
  Plus,
  Minus,
  BanknoteArrowUp,
  BanknoteArrowDown,
  X,
  Eye,
  CircleQuestionMark,
  Moon,
  ListFilter, // Keep this if used in the modal
} from "lucide-react";
import Link from "next/link";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { db } from "@/app/config/firebase";
import { collection, query, where, getDocs, orderBy, doc, getDoc } from "firebase/firestore";

// --- Constants ---
const TRANSACTION_TYPE = {
  TOP_UP: "Top-up",
  DEDUCTION: "Deducted",
  TOP_UP_PENDING: "Top-up Request",
  TOP_UP_APPROVED: "Top-up Approved",
  TOP_UP_REJECTED: "Top-up Rejected",
};

// --- Helper Functions ---

const getTransactionDetails = (type) => {
  if (type === TRANSACTION_TYPE.TOP_UP || type === TRANSACTION_TYPE.TOP_UP_APPROVED) {
    return {
      Icon: BanknoteArrowUp,
      colorClass: "text-green-500",
      bgColorClass: "bg-green-500",
      SignIcon: Plus,
    };
  }
  if (type === TRANSACTION_TYPE.TOP_UP_PENDING) {
    return {
      Icon: BanknoteArrowUp,
      colorClass: "text-orange-500",
      bgColorClass: "bg-orange-500",
      SignIcon: Plus,
    };
  }
  if (type === TRANSACTION_TYPE.TOP_UP_REJECTED) {
    return {
      Icon: BanknoteArrowUp,
      colorClass: "text-red-500",
      bgColorClass: "bg-red-500",
      SignIcon: X,
    };
  }
  return {
    Icon: BanknoteArrowDown,
    colorClass: "text-red-500",
    bgColorClass: "bg-red-500",
    SignIcon: Minus,
  };
};

const formatDate = (date) => {
  if (!date) return "N/A";
  const d = date instanceof Date ? date : date.toDate ? date.toDate() : new Date(date);
  const options = { month: "short", day: "numeric" };
  return d.toLocaleDateString("en-US", options);
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

// --- Grouping Logic ---
const groupTransactions = (transactions) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const last7DaysStart = new Date(todayStart.getTime() - 7 * 86400000);

  const todayTxs = [];
  const yesterdayTxs = [];
  const last7DaysTxs = [];

  transactions.forEach((tx) => {
    const txDate = tx.date instanceof Date ? tx.date : tx.date?.toDate ? tx.date.toDate() : new Date(tx.date);
    if (txDate >= todayStart) {
      todayTxs.push(tx);
    } else if (txDate >= yesterdayStart) {
      yesterdayTxs.push(tx);
    } else if (txDate >= last7DaysStart) {
      last7DaysTxs.push(tx);
    }
  });

  return { todayTxs, yesterdayTxs, last7DaysTxs };
};

// =================================================================
// 🖥️ TRANSACTION PAGE COMPONENT START
// =================================================================
function TransactionsContent() {
  const searchParams = useSearchParams();
  const rfidFromUrl = searchParams.get("rfid");
  
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [userData, setUserData] = useState(null);

  useEffect(() => {
    const fetchTransactions = async () => {
      if (!rfidFromUrl) {
        setLoading(false);
        return;
      }

      try {
        // Fetch user data
        const userDocRef = doc(db, "users", rfidFromUrl);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists()) {
          setUserData(userSnap.data());
        }

        // Fetch transactions from transactions collection
        const transactionsQuery = query(
          collection(db, "transactions"),
          where("userId", "==", rfidFromUrl),
          orderBy("timestamp", "desc")
        );

        const transactionsSnapshot = await getDocs(transactionsQuery);
        const transactionList = [];
        
        transactionsSnapshot.forEach((doc) => {
          const data = doc.data();
          transactionList.push({
            id: doc.id,
            type: data.type === "Top-up" ? TRANSACTION_TYPE.TOP_UP : TRANSACTION_TYPE.DEDUCTION,
            amount: data.amount || 0,
            date: data.timestamp?.toDate ? data.timestamp.toDate() : new Date(data.timestamp),
            description: data.description || "",
            minutesPurchased: data.minutesPurchased || null,
            minutesUsed: data.minutesUsed || null,
          });
        });

        // Fetch top-up requests from topup_requests collection
        const topUpQuery = query(
          collection(db, "topup_requests"),
          where("userId", "==", rfidFromUrl),
          orderBy("requestedAt", "desc")
        );

        const topUpSnapshot = await getDocs(topUpQuery);
        
        topUpSnapshot.forEach((doc) => {
          const data = doc.data();
          let transactionType;
          if (data.status === "pending") {
            transactionType = TRANSACTION_TYPE.TOP_UP_PENDING;
          } else if (data.status === "approved") {
            transactionType = TRANSACTION_TYPE.TOP_UP_APPROVED;
          } else if (data.status === "rejected") {
            transactionType = TRANSACTION_TYPE.TOP_UP_REJECTED;
          }

          transactionList.push({
            id: doc.id,
            type: transactionType,
            amount: data.amount || 0,
            date: data.requestedAt?.toDate ? data.requestedAt.toDate() : new Date(data.requestedAt),
            status: data.status,
            referenceId: data.referenceId,
            receiptURL: data.receiptURL,
            isTopUpRequest: true,
          });
        });

        // Sort all transactions by date (most recent first)
        transactionList.sort((a, b) => b.date - a.date);

        setTransactions(transactionList);
        console.log(`✅ Fetched ${transactionList.length} transaction(s)`);
      } catch (error) {
        console.error("Error fetching transactions:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchTransactions();
  }, [rfidFromUrl]);

  const { todayTxs, yesterdayTxs, last7DaysTxs } = groupTransactions(transactions);
  const hasAnyTransactions = todayTxs.length > 0 || yesterdayTxs.length > 0 || last7DaysTxs.length > 0;

  // --- Helper Components (Defined inside the page) ---

  const NoTransactionsEmptyState = () => (
    <div className="flex flex-col items-center justify-center p-6 gap-5 bg-white rounded-2xl border border-gray-300 ">
      <div className="bg-gray-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full">
        <ScrollText className="text-gray-500 size-6 sm:size-7" />
      </div>
      <div className="flex flex-col items-center justify-center gap-2">
        <div className="flex flex-col text-center">
          <span className="text-lg sm:text-xl font-semibold">
            No Transactions
          </span>
          <span className="text-gray-500 text-xs sm:text-sm">
            There are no transactions made.
          </span>
        </div>
      </div>
    </div>
  );

  const TransactionCard = ({ tx, onClick }) => {
    const { Icon, SignIcon, colorClass, bgColorClass } = getTransactionDetails(
      tx.type
    );
    const dateString = formatDate(tx.date);

    return (
      <div
        onClick={onClick}
        className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 cursor-pointer"
      >
        {/* left */}
        <div className="flex items-center gap-3">
          <div
            className={`flex items-center text-white rounded-full p-2 justify-center ${bgColorClass}`}
          >
            <Icon className="size-5" />
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{tx.type}</span>
              {/* Status Badge for Top-up Requests */}
              {tx.isTopUpRequest && tx.status === "pending" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 font-semibold border border-orange-300">
                  Pending
                </span>
              )}
              {tx.isTopUpRequest && tx.status === "approved" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-semibold border border-green-300">
                  Approved
                </span>
              )}
              {tx.isTopUpRequest && tx.status === "rejected" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold border border-red-300">
                  Rejected
                </span>
              )}
            </div>
            <span className="text-sm text-gray-500">{dateString}</span>
          </div>
        </div>
        {/* right */}
        <div className={`flex items-center gap-1 ${colorClass}`}>
          <SignIcon className="size-4" />
          <span className=" font-bold">P{tx.amount.toFixed(2)}</span>
        </div>
      </div>
    );
  };

  // Show loading state while fetching data
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
          <span className="text-gray-500">Loading transactions...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh flex justify-center text-sm sm:text-base sm:bg-white">
      <div className="flex flex-col gap-6 p-3 sm:p-4 md:px-0 w-full max-w-md">
        {/* Header */}
        <div className="relative flex items-center justify-center w-full pt-2">
          {/* left */}
          <Link
            href={`/dashboard?rfid=${encodeURIComponent(rfidFromUrl || "")}`}
            className="absolute left-0 rounded-full border border-gray-300/80 bg-white hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors duration-150  p-2"
          >
            <ChevronLeft className="size-4 sm:size-5" />
          </Link>
          {/* right */}
          {/* <button className="rounded-full border border-gray-300/80 bg-white hover:bg-gray-50 active:bg-gray-100 cursor-pointer transition-colors duration-150  p-2 sm:p-3">
            <ListFilter className="size-4 sm:size-5" />
          </button> */}
          <span className="text-base sm:text-lg font-semibold">Transactions</span>
        </div>

        {/* Main */}
        <div className="flex flex-col gap-4">
          {/* Today's Transaction */}
          {todayTxs.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm sm:text-base font-semibold">Today</span>
              <div className="flex flex-col gap-2">
                {todayTxs.map((tx) => (
                  <TransactionCard
                    key={tx.id}
                    tx={tx}
                    onClick={() => setSelectedTransaction(tx)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Yesterday's Transaction */}
          {yesterdayTxs.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm sm:text-base font-semibold">
                Yesterday
              </span>
              <div className="flex flex-col gap-2">
                {yesterdayTxs.map((tx) => (
                  <TransactionCard
                    key={tx.id}
                    tx={tx}
                    onClick={() => setSelectedTransaction(tx)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Last 7 Day Transactions */}
          {last7DaysTxs.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-sm sm:text-base font-semibold">
                Last 7 Days
              </span>
              <div className="flex flex-col gap-2">
                {last7DaysTxs.map((tx) => (
                  <TransactionCard
                    key={tx.id}
                    tx={tx}
                    onClick={() => setSelectedTransaction(tx)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Show empty state only if no transactions at all */}
          {!hasAnyTransactions && (
            <NoTransactionsEmptyState />
          )}
        </div>
      </div>

      {/* --- Modal for Specific Transaction Log --- */}
      {selectedTransaction && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            {(() => {
              // Get details for the *selected* transaction
              const { Icon, SignIcon, colorClass } = getTransactionDetails(
                selectedTransaction.type
              );

              return (
                <>
                  <div
                    className={`size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50 ${
                      colorClass.includes("green")
                        ? "bg-green-100"
                        : "bg-red-100"
                    }`}
                  >
                    <Icon className={`size-6 sm:size-7 ${colorClass}`} />
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2 ">
                    <div className="flex flex-col text-center">
                      <span className="text-base sm:text-lg font-semibold">
                        {selectedTransaction.type} Transaction
                      </span>
                      <span className="text-gray-500 text-xs sm:text-sm">
                        {formatModalDate(selectedTransaction.date)}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-col items-center justify-center py-2">
                    <span className="text-gray-500 text-xs sm:text-sm">
                      Amount
                    </span>
                    <span
                      className={`flex items-center font-semibold text-base sm:text-lg ${colorClass}`}
                    >
                      <SignIcon className="size-4 sm:size-5" />P
                      {selectedTransaction.amount.toFixed(2)}
                    </span>
                  </div>
                </>
              );
            })()}

            {/* Details */}
            {selectedTransaction.description && (
              <div className="flex flex-col gap-1 p-3 bg-gray-50 border border-gray-200 rounded-lg w-full">
                <span className="text-xs font-semibold text-gray-700">Description:</span>
                <span className="text-sm text-gray-800">{selectedTransaction.description}</span>
              </div>
            )}

            {selectedTransaction.minutesPurchased && (
              <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
                <span className="text-xs font-semibold text-gray-700">Minutes Purchased:</span>
                <span className="text-sm text-gray-800">{selectedTransaction.minutesPurchased} minutes</span>
              </div>
            )}

            {selectedTransaction.minutesUsed && (
              <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
                <span className="text-xs font-semibold text-gray-700">Minutes Used:</span>
                <span className="text-sm text-gray-800">{selectedTransaction.minutesUsed} minutes</span>
              </div>
            )}

            {/* Additional info for top-up requests */}
            {selectedTransaction.isTopUpRequest && (
              <>
                {/* Reference ID */}
                {selectedTransaction.referenceId && (
                  <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
                    <span className="text-xs font-semibold text-gray-700">GCash Reference ID:</span>
                    <span className="text-sm text-gray-800 font-mono">{selectedTransaction.referenceId}</span>
                  </div>
                )}
                
                {/* View Receipt Button */}
                {selectedTransaction.receiptURL && (
                  <a
                    href={selectedTransaction.receiptURL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="cursor-pointer text-sm px-4 py-2 border border-blue-500 bg-blue-500 text-white hover:border-blue-600 hover:bg-blue-600 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
                  >
                    <Eye className="size-4" />
                    View Receipt
                  </a>
                )}
              </>
            )}

            <div className="flex w-full items-center justify-between rounded-lg p-4 bg-gray-100">
              {/* left */}
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm font-semibold">
                  {userData?.fullName || "User"}
                </span>
                <span className="text-xs sm:text-sm text-gray-500">
                  {userData?.rfidCardId || rfidFromUrl || "N/A"}
                </span>
              </div>
              {/* right */}
              <div className="flex flex-col">
                <span className="text-xs sm:text-sm font-semibold">
                  Transaction ID:
                </span>
                <span className="text-xs sm:text-sm text-gray-500 font-mono">
                  {selectedTransaction.id.substring(0, 8)}...
                </span>
              </div>
            </div>

            {/* close specific transaction log modal */}
            <button
              onClick={() => setSelectedTransaction(null)}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-500/90 hover:bg-green-500/90  active:border-green-600 active:bg-green-600 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Transactions() {
  return (
    <Suspense
      fallback={
        <div className="min-h-dvh flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
            <span className="text-gray-500">Loading transactions...</span>
          </div>
        </div>
      }
    >
      <TransactionsContent />
    </Suspense>
  );
}
