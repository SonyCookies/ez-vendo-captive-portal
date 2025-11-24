"use client";

import {
  Plus,
  Bell,
  Eye,
  ScrollText,
  Moon,
  BanknoteX,
  CircleQuestionMark,
  ChevronRight,
  ChevronDown,
  BanknoteArrowUp,
  TimerOff,
  TriangleAlert,
  CircleStop,
  CheckCircle,
  CheckCircle2,
  Minus,
  BanknoteArrowDown,
  WifiOff,
  X,
  XCircle,
  Clock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { db, storage } from "@/app/config/firebase";
import { doc, getDoc, updateDoc, increment, serverTimestamp, setDoc, collection, addDoc, query, where, getDocs, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

// Suppress expected network errors in captive portal environment
if (typeof window !== 'undefined') {
  // Suppress Firestore connection errors (expected in captive portal)
  const originalError = console.error;
  console.error = (...args) => {
    const errorMessage = args[0]?.toString() || '';
    // Suppress expected network errors
    if (
      errorMessage.includes('ERR_INTERNET_DISCONNECTED') ||
      errorMessage.includes('firestore.googleapis.com') ||
      errorMessage.includes('WebSocket connection') ||
      errorMessage.includes('cleardot.gif') ||
      errorMessage.includes('net::ERR_INTERNET_DISCONNECTED')
    ) {
      // Silently ignore expected network errors in captive portal
      return;
    }
    originalError.apply(console, args);
  };

  // Suppress unhandled promise rejections for network errors
  window.addEventListener('unhandledrejection', (event) => {
    const errorMessage = event.reason?.message || event.reason?.toString() || '';
    if (
      errorMessage.includes('ERR_INTERNET_DISCONNECTED') ||
      errorMessage.includes('firestore.googleapis.com') ||
      errorMessage.includes('Failed to fetch') ||
      errorMessage.includes('NetworkError')
    ) {
      event.preventDefault(); // Suppress the error
    }
  });
}

// CONSTANTS
const INITIAL_BALANCE = 0.0;
const LOW_BALANCE_THRESHOLD = 10.0;
const PING_INTERVAL_MS = 1000;
const TRANSACTION_TYPE = {
  TOP_UP: "Top-up",
  DEDUCTION: "Deducted",
  TOP_UP_PENDING: "Top-up Request",
  TOP_UP_APPROVED: "Top-up Approved",
  TOP_UP_REJECTED: "Top-up Rejected",
};

export default function Dashboard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rfidFromUrl = searchParams.get("rfid");

  // --- USER DATA STATE ---
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [hasAutoStarted, setHasAutoStarted] = useState(false);

  // --- SYSTEM CONFIG STATE ---
  const [billingRatePerMinute, setBillingRatePerMinute] = useState(0.5); // Default P0.50/min
  const [configLoading, setConfigLoading] = useState(true);

  // --- TIME PACKAGE STATE (NEW!) ---
  const [sessionStartTime, setSessionStartTime] = useState(null); // Timestamp when session actually started
  const [sessionEndTime, setSessionEndTime] = useState(null); // Timestamp when session should end
  const [activeTimeRemaining, setActiveTimeRemaining] = useState(300); // Start with 5-min grace period
  const [hasActiveTime, setHasActiveTime] = useState(true); // Grace period is active by default

  // --- STATE MANAGEMENT ---
  const [userBalance, setUserBalance] = useState(INITIAL_BALANCE);
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [transactionHistory, setTransactionHistory] = useState([]);

  // Modal Control States
  const [showSessionExpiredModal, setShowSessionExpiredModal] = useState(false);
  const [showLowCreditWarning, setShowLowCreditWarning] = useState(false);
  const [isZeroModalDismissed, setIsZeroModalDismissed] = useState(false);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const [showStopSuccess, setShowStopSuccess] = useState(false);
  const [showTopUpInstructions, setShowTopUpInstructions] = useState(false);
  const [isTopUpModalClosing, setIsTopUpModalClosing] = useState(false);
  const [isTopUpModalOpening, setIsTopUpModalOpening] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showZeroBalanceModal, setShowZeroBalanceModal] = useState(false); // NEW: Show when balance is 0
  const [showTimeRestoredModal, setShowTimeRestoredModal] = useState(false); // Show when saved time is restored
  const [restoredTimeSeconds, setRestoredTimeSeconds] = useState(0); // Amount of time restored
  const [showEndSessionConfirm, setShowEndSessionConfirm] = useState(false); // Show end session confirmation modal
  const [showEndSessionSuccess, setShowEndSessionSuccess] = useState(false); // Show end session success modal
  const [showEndSessionError, setShowEndSessionError] = useState(false); // Show end session error modal
  const [endSessionError, setEndSessionError] = useState(""); // Error message for end session
  const [savedTimeMinutes, setSavedTimeMinutes] = useState(0); // Amount of time saved (for modal display)
  const [isEndingSession, setIsEndingSession] = useState(false); // Loading state for ending session
  const [revokeSuccess, setRevokeSuccess] = useState(false); // Track if revoke was successful
  
  // Purchase Confirmation States
  const [showPurchaseConfirm, setShowPurchaseConfirm] = useState(false);
  const [selectedMinutes, setSelectedMinutes] = useState(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [isPurchaseModalClosing, setIsPurchaseModalClosing] = useState(false);
  const [isPurchaseModalOpening, setIsPurchaseModalOpening] = useState(false);
  
  // Purchase Success/Error Modal States
  const [showPurchaseSuccess, setShowPurchaseSuccess] = useState(false);
  const [showPurchaseError, setShowPurchaseError] = useState(false);
  const [purchaseMessage, setPurchaseMessage] = useState("");
  
  // Top-up Form States
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpReferenceId, setTopUpReferenceId] = useState("");
  const [topUpPaymentMethod, setTopUpPaymentMethod] = useState("GCASH"); // Default to GCASH
  const [topUpReceipt, setTopUpReceipt] = useState(null);
  const [topUpReceiptPreview, setTopUpReceiptPreview] = useState(null);
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);
  const [showReceiptPreview, setShowReceiptPreview] = useState(false);
  const [receiptPreviewLoading, setReceiptPreviewLoading] = useState(true);

  // Payment Methods Configuration
  const PAYMENT_METHODS = {
    MAYA: {
      number: "09266301717",
      name: "Sonny S.",
      prefix: "MAYA"
    },
    GCASH: {
      number: "09266301717",
      name: "Sonny S.",
      prefix: "GCASH"
    },
    MARIBANK: {
      number: "1963 708 5042",
      name: "SONNY SARCIA",
      prefix: "MARI"
    },
    GOTYME: {
      number: "0142 0666 6695",
      name: "SONNY SARCIA",
      prefix: "GOTYME"
    }
  };

  // --- CALCULATED STATE / DYNAMIC STYLES ---
  const isLowBalance = userBalance <= 0;
  const isWarningLevel =
    userBalance > 0 && userBalance <= LOW_BALANCE_THRESHOLD;
  const showNoCreditModal = isLowBalance && !isZeroModalDismissed;
  const disableControlButtons = isLowBalance;

  // Calculate time remaining based on balance and billing rate
  const timeRemainingMinutes = billingRatePerMinute > 0 
    ? Math.floor(userBalance / billingRatePerMinute) 
    : 0;
  const timeRemainingSeconds = billingRatePerMinute > 0
    ? Math.floor((userBalance / billingRatePerMinute) * 60)
    : 0;

  const sessionButtonText = isSessionActive ? "Stop" : "Start";
  const pulsingBaseColor = isSessionActive ? "bg-red" : "bg-green";
  const sessionBaseColor = isSessionActive
    ? "bg-red-400 hover:bg-red-500"
    : "bg-green-400 hover:bg-green-500";
  const sessionButtonFinalClasses = disableControlButtons
    ? `bg-gray-400 text-white cursor-not-allowed`
    : `${sessionBaseColor} text-white cursor-pointer`;

  const handleStartStopSession = async () => {
    if (isSessionActive) {
      setShowStopConfirm(true);
    } else {
      // START LOGIC
      if (userBalance > 0) {
        try {
          // Just mark session as started in Firestore
          // Balance will deplete based on time used
          const userDocRef = doc(db, "users", rfidFromUrl);
          await updateDoc(userDocRef, {
            sessionStartedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });

          // Activate Session (no upfront deduction)
          setIsSessionActive(true);
          
          console.log("✅ Session started manually");
        } catch (error) {
          console.error("Error starting session:", error);
        }
      }
    }
  };
  const finalizeStopSession = async () => {
    // Calculate total cost before stopping
    const minutesUsed = Math.ceil(elapsedSeconds / 60);
    const costIncurred = minutesUsed * billingRatePerMinute;
    const amountToDeduct = Math.min(costIncurred, userBalance); // Don't go negative

    try {
      // Deduct the actual amount used when stopping
      const userDocRef = doc(db, "users", rfidFromUrl);
      await updateDoc(userDocRef, {
        balance: increment(-amountToDeduct),
        sessionStartedAt: null, // Clear session start
        updatedAt: serverTimestamp(),
      });

      // Update local state
      setUserBalance((prev) => Math.max(0, prev - amountToDeduct));

      // Add deduction transaction
      setTransactionHistory((currentHistory) => [
        {
          id: `D-${Date.now()}`,
          type: TRANSACTION_TYPE.DEDUCTION,
          amount: amountToDeduct,
          date: new Date(),
          minutesUsed: minutesUsed,
        },
        ...currentHistory,
      ]);

      // Save session history to session_history collection
      const actualSessionStartTime = sessionStartTime || new Date(Date.now() - (elapsedSeconds * 1000));
      const sessionEndTimeDate = new Date();
      const actualDuration = actualSessionStartTime ? Math.floor((sessionEndTimeDate - actualSessionStartTime) / 1000) : elapsedSeconds;
      
      const sessionHistoryData = {
        userId: rfidFromUrl,
        userName: userData?.fullName || "Unknown",
        sessionStartTime: actualSessionStartTime,
        sessionEndTime: sessionEndTimeDate,
        durationSeconds: actualDuration,
        timeRemainingSeconds: 0,
        timeRemainingMinutes: 0,
        action: "manually_stopped",
        savedForNextSession: false,
        amountDeducted: amountToDeduct,
        minutesUsed: minutesUsed,
        timestamp: serverTimestamp(), // For ordering in queries
        createdAt: serverTimestamp(),
      };
      
      const sessionHistoryRef = await addDoc(collection(db, "session_history"), sessionHistoryData);
      console.log("✅ Session history saved:", sessionHistoryRef.id);

      console.log(`💰 Deducted P${amountToDeduct.toFixed(2)} for ${minutesUsed} minutes`);
    } catch (error) {
      console.error("Error stopping session:", error);
    }

      setIsSessionActive(false);
      setSessionStartTime(null);
      setElapsedSeconds(0); // Reset elapsed time
      setShowStopConfirm(false);
      setShowStopSuccess(true); // Show success modal (which redirects after 3s)
  };

  const handleContinueSession = () => {
    setShowStopConfirm(false); // Close confirmation modal and resume
  };

  // --- END SESSION HANDLER (Save remaining time) ---
  const handleEndSession = () => {
    // Show confirmation modal
    setShowEndSessionConfirm(true);
  };

  const confirmEndSession = async () => {
    if (!hasActiveTime || !sessionEndTime || activeTimeRemaining <= 0) {
      setShowEndSessionConfirm(false);
      setEndSessionError("No active session or time remaining to save.");
      setShowEndSessionError(true);
      return;
    }

    setIsEndingSession(true);
    setRevokeSuccess(false);
    const timeToSave = activeTimeRemaining;
    const minutesToSave = Math.floor(timeToSave / 60);

    try {
      // 1. FIRST: Save remaining time to Firebase (critical - must succeed before revoking access)
      console.log("💾 Saving remaining time to Firebase...");
      const userDocRef = doc(db, "users", rfidFromUrl);
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      
      await updateDoc(userDocRef, {
        savedRemainingTimeSeconds: timeToSave, // Save remaining seconds
        savedTimeDate: today, // Save the date when time was saved
        sessionStartTime: null, // Clear session start time
        sessionEndTime: null, // Clear active session
        updatedAt: serverTimestamp(),
      });
      
      console.log(`✅ Saved ${timeToSave} seconds (${minutesToSave} minutes) to Firebase`);
      
      // 2. Save session history to session_history collection
      // Get actual session start time from Firestore if not in state
      let actualSessionStartTime = null;
      if (sessionStartTime) {
        actualSessionStartTime = typeof sessionStartTime === 'number' ? new Date(sessionStartTime) : sessionStartTime;
      } else {
        // Try to get from userData, or calculate backwards from sessionEndTime
        const userDocRef = doc(db, "users", rfidFromUrl);
        const userSnap = await getDoc(userDocRef);
        if (userSnap.exists() && userSnap.data().sessionStartTime) {
          const storedStartTime = userSnap.data().sessionStartTime;
          actualSessionStartTime = storedStartTime?.toDate ? storedStartTime.toDate() : new Date(storedStartTime);
        } else if (sessionEndTime && activeTimeRemaining > 0) {
          // Fallback: Calculate backwards (not ideal but better than nothing)
          // Assume the total session duration was the purchased time + grace period
          actualSessionStartTime = new Date(sessionEndTime - ((activeTimeRemaining + Math.floor((Date.now() - sessionEndTime) / 1000)) * 1000));
        } else {
          actualSessionStartTime = new Date(Date.now() - 300); // Default to 5 minutes ago
        }
      }
      
      const sessionEndTimeDate = new Date();
      const actualDuration = actualSessionStartTime ? Math.floor((sessionEndTimeDate - actualSessionStartTime) / 1000) : 0;
      
      console.log("📊 Saving session history:", {
        startTime: actualSessionStartTime.toISOString(),
        endTime: sessionEndTimeDate.toISOString(),
        duration: actualDuration,
        durationFormatted: `${Math.floor(actualDuration / 60)}:${(actualDuration % 60).toString().padStart(2, '0')}`
      });
      
      const sessionHistoryData = {
        userId: rfidFromUrl,
        userName: userData?.fullName || "Unknown",
        sessionStartTime: actualSessionStartTime,
        sessionEndTime: sessionEndTimeDate,
        durationSeconds: actualDuration,
        timeRemainingSeconds: timeToSave,
        timeRemainingMinutes: minutesToSave,
        action: "ended_with_time_saved", // "ended_with_time_saved" or "expired" or "manually_stopped"
        savedForNextSession: true,
        savedTimeDate: today,
        timestamp: serverTimestamp(), // For ordering in queries
        createdAt: serverTimestamp(),
      };
      
      const sessionHistoryRef = await addDoc(collection(db, "session_history"), sessionHistoryData);
      console.log("✅ Session history saved:", sessionHistoryRef.id);
      
      // 3. THEN: Revoke internet access from Orange Pi (only after successful save)
      console.log("🔌 Revoking internet access from Orange Pi...");
      let revokeWorked = false;
      try {
        const revokeResponse = await fetch(`http://192.168.1.1:8080/revoke-access`, {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });

        if (revokeResponse.ok) {
          const revokeData = await revokeResponse.json();
          console.log("✅ Internet access revoked:", revokeData);
          setRevokeSuccess(true);
          revokeWorked = true;
        } else {
          const errorText = await revokeResponse.text();
          console.warn("⚠️ Failed to revoke access via API:", revokeResponse.status, errorText);
          setRevokeSuccess(false);
          // Time is already saved, so this is non-critical - user can manually disconnect
        }
      } catch (error) {
        console.error("⚠️ Error calling revoke API:", error);
        setRevokeSuccess(false);
        // Time is already saved, so this is non-critical - user can manually disconnect
      }

      // 4. Clear local session state
      setSessionStartTime(null);
      setSessionEndTime(null);
      setActiveTimeRemaining(0);
      setHasActiveTime(false);
      setIsSessionActive(false);
      
      // 5. Clear from sessionStorage
      sessionStorage.removeItem('ezvendo_active_session');
      
      // 6. Show success modal
      setSavedTimeMinutes(minutesToSave);
      setShowEndSessionConfirm(false);
      setShowEndSessionSuccess(true);
      
      console.log(`✅ Session ended successfully - ${minutesToSave} minutes saved for next visit`);
      if (revokeWorked) {
        console.log("✅ Internet access successfully revoked");
      } else {
        console.warn("⚠️ Internet access may still be active (revoke failed, but time saved)");
        console.log("   User can manually disconnect or try ending session again");
      }
    } catch (error) {
      console.error("Error ending session:", error);
      setShowEndSessionConfirm(false);
      setIsEndingSession(false);
      setEndSessionError(error.message || "Failed to save remaining time. Please try again.");
      setShowEndSessionError(true);
    } finally {
      setIsEndingSession(false);
    }
  };

  // 4. Top-up / Dismissal Handlers
  const handleTopUp = () => {
    setIsTopUpModalClosing(false);
    setIsTopUpModalOpening(false);
    setShowTopUpInstructions(true);
    setShowLowCreditWarning(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsTopUpModalOpening(true);
      });
    });
  };

  const finalizeTopUp = async () => {
    const topUpAmount = 15.0;

    try {
      // Update balance in Firestore
      const userDocRef = doc(db, "users", rfidFromUrl);
      await updateDoc(userDocRef, {
        balance: increment(topUpAmount),
        updatedAt: serverTimestamp(),
      });

      // Update local balance
      setUserBalance((prev) => prev + topUpAmount);

      // Save transaction to Firebase
      const transactionData = {
        userId: rfidFromUrl,
        type: TRANSACTION_TYPE.TOP_UP,
        amount: topUpAmount,
        timestamp: serverTimestamp(),
        description: `Balance top-up of ₱${topUpAmount.toFixed(2)}`,
      };
      
      const transactionRef = await addDoc(collection(db, "transactions"), transactionData);
      console.log("✅ Top-up transaction saved to Firestore:", transactionRef.id);
      
      // Add to local transaction history
      setTransactionHistory((currentHistory) => [
        {
          id: transactionRef.id,
          type: TRANSACTION_TYPE.TOP_UP,
          amount: topUpAmount,
          date: new Date(),
        },
        ...currentHistory,
      ]);

      closeTopUpModal();

      // Reset dismissal states
      setIsZeroModalDismissed(false);
      setShowLowCreditWarning(false);

      console.log("✅ Balance topped up successfully");
    } catch (error) {
      console.error("❌ Error topping up balance:", error);
    }
  };

  // Handle receipt file upload
  const handleReceiptUpload = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setTopUpReceipt(file);
      // Create preview URL
      const reader = new FileReader();
      reader.onloadend = () => {
        setTopUpReceiptPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  // Remove uploaded receipt
  const handleRemoveReceipt = () => {
    setTopUpReceipt(null);
    setTopUpReceiptPreview(null);
    // Reset file input
    const fileInput = document.getElementById('receipt-upload-input');
    if (fileInput) {
      fileInput.value = '';
    }
  };

  // Handle receipt preview click
  const handleReceiptPreviewClick = () => {
    if (topUpReceiptPreview) {
      setReceiptPreviewLoading(true);
      setShowReceiptPreview(true);
    }
  };

  // Close receipt preview
  const handleCloseReceiptPreview = () => {
    setShowReceiptPreview(false);
    setReceiptPreviewLoading(true);
  };

  // Handle receipt preview image load
  const handleReceiptPreviewImageLoad = () => {
    setReceiptPreviewLoading(false);
  };

  // Submit top-up request
  const handleSubmitTopUp = async () => {
    // Validation
    if (!topUpAmount || parseFloat(topUpAmount) <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    if (!topUpReferenceId || topUpReferenceId.trim() === "") {
      const selectedMethod = PAYMENT_METHODS[topUpPaymentMethod];
      alert(`Please enter the ${topUpPaymentMethod} reference ID`);
      return;
    }
    if (!topUpReceipt) {
      alert("Please attach your payment receipt");
      return;
    }
    if (!topUpPaymentMethod || !PAYMENT_METHODS[topUpPaymentMethod]) {
      alert("Please select a payment method");
      return;
    }

    setIsSubmittingTopUp(true);

    try {
      console.log("📤 Uploading receipt to Firebase Storage...");
      
      // 1. Upload receipt to Firebase Storage
      // Create a unique filename: receipts/{userId}/{timestamp}_{originalName}
      const timestamp = Date.now();
      const fileName = `${timestamp}_${topUpReceipt.name}`;
      const storageRef = ref(storage, `receipts/${rfidFromUrl}/${fileName}`);
      
      // Upload the file
      const uploadResult = await uploadBytes(storageRef, topUpReceipt);
      console.log("✅ Receipt uploaded to Storage");
      
      // 2. Get the download URL
      const receiptURL = await getDownloadURL(uploadResult.ref);
      console.log("✅ Receipt URL:", receiptURL);
      
      // 3. Generate document ID: PAYMENT_METHOD_PREFIX-(reference number)
      const selectedMethod = PAYMENT_METHODS[topUpPaymentMethod];
      const documentId = `${selectedMethod.prefix}-${topUpReferenceId.trim()}`;
      
      // 4. Save top-up request to Firestore with custom document ID
      const topUpRequest = {
        userId: rfidFromUrl,
        userName: userData?.fullName || "Unknown",
        userEmail: userData?.email || "N/A",
        amount: parseFloat(topUpAmount),
        referenceId: topUpReferenceId.trim(),
        receiptURL: receiptURL, // Download URL from Firebase Storage
        receiptFileName: topUpReceipt.name,
        receiptStoragePath: `receipts/${rfidFromUrl}/${fileName}`, // For admin reference/deletion
        status: "pending", // pending, approved, rejected
        requestedAt: serverTimestamp(),
        paymentMethod: topUpPaymentMethod,
        type: "topup_request", // Type field as requested
      };

      // Use setDoc instead of addDoc to allow custom document IDs
      const requestDocRef = doc(db, "topup_requests", documentId);
      await setDoc(requestDocRef, topUpRequest);
      console.log("✅ Top-up request submitted with document ID:", documentId);

      // Add to transaction history immediately (so user sees it!)
      setTransactionHistory(prev => [{
        id: documentId,
        type: TRANSACTION_TYPE.TOP_UP_PENDING,
        amount: parseFloat(topUpAmount),
        date: new Date(),
        status: "pending",
        referenceId: topUpReferenceId.trim(),
        receiptURL: receiptURL,
        paymentMethod: topUpPaymentMethod,
        isTopUpRequest: true,
      }, ...prev]);

      // Show success state
      setTopUpSuccess(true);
      
      // Reset form after 2 seconds
      setTimeout(() => {
        setTopUpSuccess(false);
        closeTopUpModal();
        setTopUpAmount("");
        setTopUpReferenceId("");
        setTopUpPaymentMethod("GCASH"); // Reset to default
        setTopUpReceipt(null);
        setTopUpReceiptPreview(null);
        setIsSubmittingTopUp(false);
      }, 2000);

    } catch (error) {
      console.error("❌ Error submitting top-up request:", error);
      
      // More specific error messages
      if (error.code === 'storage/unauthorized') {
        alert("Failed to upload receipt. Storage permissions error. Please contact admin.");
      } else if (error.code === 'storage/quota-exceeded') {
        alert("Storage quota exceeded. Please contact admin.");
      } else {
        alert(`Failed to submit request: ${error.message}`);
      }
      
      setIsSubmittingTopUp(false);
    }
  };

  // Cancel top-up
  // Close top-up modal with animation
  const closeTopUpModal = () => {
    if (isTopUpModalClosing || isSubmittingTopUp) return;
    setIsTopUpModalOpening(false);
    setIsTopUpModalClosing(true);
    setTimeout(() => {
      setShowTopUpInstructions(false);
      setTopUpAmount("");
      setTopUpReferenceId("");
      setTopUpPaymentMethod("GCASH"); // Reset to default
      setTopUpReceipt(null);
      setTopUpReceiptPreview(null);
      setShowReceiptPreview(false);
      setIsTopUpModalClosing(false);
    }, 300);
  };

  const handleCancelTopUp = () => {
    closeTopUpModal();
    setTopUpReceiptPreview(null);
    setTopUpSuccess(false);
  };

  const handleModalClose = () => {
    // Used by P0.00 Modal and Session Expired Modal
    setIsZeroModalDismissed(true);
    setShowSessionExpiredModal(false);
  };

  const handleWarningDismiss = () => {
    setShowLowCreditWarning(false);
  };

  // --- HANDLE TIME PACKAGE SELECTION (Show Confirmation) ---
  const handleTimePackageClick = (minutes) => {
    const cost = minutes * billingRatePerMinute;
    
    // Check if user has sufficient balance
    if (userBalance < cost) {
      alert(`Insufficient balance! You need ₱${cost.toFixed(2)} but only have ₱${userBalance.toFixed(2)}`);
      return;
    }
    
    // Show confirmation modal with animation
    setIsPurchaseModalClosing(false);
    setIsPurchaseModalOpening(false);
    setSelectedMinutes(minutes);
    setShowPurchaseConfirm(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsPurchaseModalOpening(true);
      });
    });
  };

  // Close purchase confirmation modal with animation
  const closePurchaseConfirmModal = () => {
    if (isPurchaseModalClosing || isPurchasing) return;
    setIsPurchaseModalOpening(false);
    setIsPurchaseModalClosing(true);
    setTimeout(() => {
      setShowPurchaseConfirm(false);
      setSelectedMinutes(null);
      setIsPurchaseModalClosing(false);
    }, 300);
  };

  // Generate random alphanumeric string
  const generateRandomAlphanumeric = (length) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  // Get package number based on minutes
  const getPackageNumber = (minutes) => {
    const packageMap = {
      5: 1,
      10: 2,
      30: 3,
      60: 4,
    };
    return packageMap[minutes] || 1; // Default to PACK1 if not found
  };

  // Helper function to calculate total time from all transactions
  const calculateTotalTimeFromTransactions = async (userId) => {
    try {
      let transactionsSnapshot;
      try {
        const transactionsQuery = query(
          collection(db, "transactions"),
          where("userId", "==", userId),
          orderBy("timestamp", "desc")
        );
        transactionsSnapshot = await getDocs(transactionsQuery);
      } catch (error) {
        // If orderBy fails, try without it
        console.warn("OrderBy failed, using simple query:", error);
        const transactionsQuery = query(
          collection(db, "transactions"),
          where("userId", "==", userId)
        );
        transactionsSnapshot = await getDocs(transactionsQuery);
      }
      
      let totalMinutes = 0;
      transactionsSnapshot.forEach((doc) => {
        const data = doc.data();
        if (data.minutesPurchased) {
          totalMinutes += Number(data.minutesPurchased) || 0;
        }
      });
      
      return totalMinutes;
    } catch (error) {
      console.error("Error calculating total time from transactions:", error);
      return 0;
    }
  };

  // --- PURCHASE TIME PACKAGE (After Confirmation) ---
  const purchaseTimePackage = async (minutes) => {
    const durationSeconds = minutes * 60;
    const cost = minutes * billingRatePerMinute;
    
    // Check if user has sufficient balance (double check)
    if (userBalance < cost) {
      alert(`Insufficient balance! You need ₱${cost.toFixed(2)} but only have ₱${userBalance.toFixed(2)}`);
      setShowPurchaseConfirm(false);
      setSelectedMinutes(null);
      return;
    }
    
    setIsPurchasing(true);
    
    try {
      console.log(`💰 Purchasing ${minutes} minutes for ₱${cost.toFixed(2)}`);
      
      // Deduct balance from Firestore
      const userDocRef = doc(db, "users", rfidFromUrl);
      await updateDoc(userDocRef, {
        balance: increment(-cost),
        updatedAt: serverTimestamp(),
      });
      
      // Update local balance
      setUserBalance(prev => prev - cost);
      
      // Generate custom document ID: PACK{number}-{6 random alphanumeric characters}
      const packageNumber = getPackageNumber(minutes);
      const randomChars = generateRandomAlphanumeric(6);
      const customDocumentId = `PACK${packageNumber}-${randomChars}`;
      
      // Save transaction to Firebase with custom document ID
      const transactionData = {
        userId: rfidFromUrl,
        type: TRANSACTION_TYPE.DEDUCTION,
        amount: cost,
        minutesPurchased: minutes,
        timestamp: serverTimestamp(),
        description: `Purchased ${minutes} minutes of internet`,
      };
      
      const transactionDocRef = doc(db, "transactions", customDocumentId);
      await setDoc(transactionDocRef, transactionData);
      console.log("✅ Transaction saved to Firestore with custom ID:", customDocumentId);
      
      // Add to local transaction history
      setTransactionHistory(prev => [{
        id: customDocumentId,
        type: TRANSACTION_TYPE.DEDUCTION,
        amount: cost,
        date: new Date(),
        minutesUsed: minutes,
      }, ...prev]);
      
      console.log("✅ Balance deducted, calculating new session end time...");
      
      // Get current user data to check for saved time and grace period
      const userSnap = await getDoc(userDocRef);
      const userData = userSnap.exists() ? userSnap.data() : {};
      
      // Check for saved time
      const savedRemainingTime = userData.savedRemainingTimeSeconds || 0;
      const savedTimeDate = userData.savedTimeDate || null;
      const today = new Date().toISOString().split('T')[0];
      const isNewDay = savedTimeDate !== today;
      
      // Check for grace period eligibility
      const lastGracePeriodDate = userData.lastGracePeriodDate || null;
      const canGrantGracePeriod = lastGracePeriodDate !== today;
      
      const now = Date.now();
      let newEndTime;
      let actualStartTime = sessionStartTime;
      let timeToAdd = durationSeconds; // Start with purchased time
      
      // If there's saved time and no active session, include it
      if (savedRemainingTime > 0 && (!sessionEndTime || sessionEndTime <= now)) {
        timeToAdd += savedRemainingTime;
        console.log(`💾 Including ${Math.floor(savedRemainingTime / 60)} minutes of saved time`);
        
        // If it's a new day and grace period is available, add grace period too
        if (isNewDay && canGrantGracePeriod) {
          timeToAdd += 300; // 5 minutes grace period
          console.log(`🎁 Including 5-minute grace period (new day)`);
        }
      }
      
      // Calculate new session end time
      if (sessionEndTime && sessionEndTime > now) {
        // Active session exists - add new time (including saved time/grace if applicable) to existing end time
        newEndTime = sessionEndTime + (timeToAdd * 1000);
        actualStartTime = sessionStartTime || now;
        console.log(`➕ Adding ${Math.floor(timeToAdd / 60)} minutes to existing session. New end time: ${new Date(newEndTime).toLocaleString()}`);
      } else {
        // No active session - start new session from now (includes saved time/grace if applicable)
        newEndTime = now + (timeToAdd * 1000);
        actualStartTime = now;
        console.log(`🆕 Starting new session with ${Math.floor(timeToAdd / 60)} minutes. End time: ${new Date(newEndTime).toLocaleString()}`);
      }
      
      // Calculate remaining time for Orange Pi API call
      const remainingTimeSeconds = Math.floor((newEndTime - now) / 1000);
      
      // Prepare update data
      const updateData = {
        sessionStartTime: actualStartTime,
        sessionEndTime: newEndTime,
        updatedAt: serverTimestamp(),
      };
      
      // Clear saved time if it was included
      if (savedRemainingTime > 0 && (!sessionEndTime || sessionEndTime <= now)) {
        updateData.savedRemainingTimeSeconds = null;
        updateData.savedTimeDate = null;
      }
      
      // Record grace period if it was granted
      if (savedRemainingTime > 0 && isNewDay && canGrantGracePeriod && (!sessionEndTime || sessionEndTime <= now)) {
        updateData.lastGracePeriodDate = today;
      }
      
      // Update Firestore with new session times
      await updateDoc(userDocRef, updateData);
      
      console.log(`🌐 Requesting ${Math.floor(remainingTimeSeconds / 60)} minutes remaining (${remainingTimeSeconds} seconds) from Orange Pi`);
      
      // Call Orange Pi API with REMAINING time (not total purchased time)
      // Orange Pi will auto-detect client IP from the HTTP request (like ESP32 does!)
      const response = await fetch(`http://192.168.1.1:8080/grant-time?duration=${remainingTimeSeconds}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("✅ Internet access granted:", data);
        
        // Update local state
        setSessionStartTime(actualStartTime);
        setSessionEndTime(newEndTime);
        setActiveTimeRemaining(remainingTimeSeconds);
        setHasActiveTime(true);
        setIsSessionActive(true);
        
        // Update session in sessionStorage
        sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
          rfid: rfidFromUrl,
          sessionStartTime: actualStartTime,
          sessionEndTime: newEndTime
        }));
        
        console.log("💾 Session updated in storage and Firestore");
        
        // Close confirmation modal
        setShowPurchaseConfirm(false);
        setSelectedMinutes(null);
        setIsPurchasing(false);
        
        // Show success modal
        const remainingMinutes = Math.floor(remainingTimeSeconds / 60);
        setPurchaseMessage(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'} added! Remaining time: ${remainingMinutes} ${remainingMinutes === 1 ? 'minute' : 'minutes'}`);
        setShowPurchaseSuccess(true);
      } else {
        console.error("❌ Failed to grant internet access");
        setIsPurchasing(false);
        
        // Show error modal
        setPurchaseMessage("Failed to activate internet. Please try again.");
        setShowPurchaseError(true);
      }
      
    } catch (error) {
      console.error("❌ Error purchasing time:", error);
      setIsPurchasing(false);
      setShowPurchaseConfirm(false);
      setSelectedMinutes(null);
      
      // Show error modal
      setPurchaseMessage("Failed to purchase time package. Please try again.");
      setShowPurchaseError(true);
    }
  };

  // --- FETCH SYSTEM CONFIG FROM FIRESTORE ---
  useEffect(() => {
    const fetchSystemConfig = async () => {
      try {
        const configDocRef = doc(db, "system_config", "global_settings");
        const configSnap = await getDoc(configDocRef);

        if (configSnap.exists()) {
          const config = configSnap.data();
          setBillingRatePerMinute(config.billingRatePerMinute || 0.5);
          console.log("✅ System config loaded:", config);
        } else {
          console.warn("⚠️ System config not found, using defaults");
          // Create default config if it doesn't exist
          await setDoc(configDocRef, {
            configId: "global_settings",
            billingRatePerMinute: 0.5, // P0.50 per minute
            lastUpdatedBy: "system",
            lastUpdatedAt: serverTimestamp(),
          });
          setBillingRatePerMinute(0.5);
        }
        setConfigLoading(false);
      } catch (error) {
        // Suppress network errors in captive portal environment
        if (error?.code === 'unavailable' || error?.message?.includes('ERR_INTERNET_DISCONNECTED') || error?.message?.includes('Failed to fetch')) {
          console.warn("⚠️ Network unavailable, using default billing rate");
        } else {
          console.error("Error fetching system config:", error);
        }
        setBillingRatePerMinute(0.5); // Fallback to default
        setConfigLoading(false);
      }
    };

    fetchSystemConfig();
  }, []);

  // --- FETCH USER DATA FROM FIRESTORE ---
  useEffect(() => {
    const fetchUserData = async () => {
      if (!rfidFromUrl) {
        // No RFID provided, redirect to home
        router.push("/");
        return;
      }

      try {
        // Add timeout protection for captive portal (30 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Connection timeout")), 30000)
        );

        const userDocRef = doc(db, "users", rfidFromUrl);
        const userSnap = await Promise.race([
          getDoc(userDocRef),
          timeoutPromise
        ]);

        if (userSnap.exists()) {
          const data = userSnap.data();
          
          // Check if user is actually registered
          if (!data.isRegistered) {
            console.log("User not registered, redirecting...");
            router.push("/");
            return;
          }

          setUserData(data);
          const currentBalance = data.balance || 0;
          setUserBalance(currentBalance);
          
          // Check if grace period was already granted today
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
          const lastGracePeriodDate = data.lastGracePeriodDate || null;
          const canGrantGracePeriod = lastGracePeriodDate !== today;
          
          // Check for saved remaining time
          const savedRemainingTime = data.savedRemainingTimeSeconds || 0;
          const savedTimeDate = data.savedTimeDate || null;
          const isNewDay = savedTimeDate !== today;
          
          console.log("✅ Dashboard loaded");
          console.log("ℹ️ Balance: ₱" + currentBalance.toFixed(2));
          console.log("🎁 Grace period eligibility:", canGrantGracePeriod ? "YES (not granted today)" : "NO (already granted today)");
          console.log("📅 Last grace period date:", lastGracePeriodDate || "Never");
          console.log("📅 Today's date:", today);
          console.log("💾 Saved time:", savedRemainingTime, "seconds");
          console.log("📅 Saved time date:", savedTimeDate || "Never");
          console.log("🔄 Is new day:", isNewDay);
          
          // PRIORITY 1: Restore existing active session if it exists and hasn't expired
          // sessionEndTime is the source of truth - it tracks when the session ends
          if (data.sessionEndTime && data.sessionEndTime > Date.now()) {
            const existingEndTime = data.sessionEndTime;
            const existingStartTime = data.sessionStartTime || (existingEndTime ? new Date(existingEndTime - ((existingEndTime - Date.now()) / 1000) * 1000) : new Date());
            const remaining = Math.floor((existingEndTime - Date.now()) / 1000);
            
            console.log("🔄 Restoring existing session from Firestore");
            console.log("   Start time:", new Date(existingStartTime).toLocaleString());
            console.log("   End time:", new Date(existingEndTime).toLocaleString());
            console.log("   Time remaining:", Math.floor(remaining / 60), "minutes");
            
            setSessionStartTime(existingStartTime);
            setSessionEndTime(existingEndTime);
            setActiveTimeRemaining(remaining);
            setHasActiveTime(true);
            setIsSessionActive(true);
            
            // Also save to sessionStorage
            sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
              rfid: rfidFromUrl,
              sessionStartTime: existingStartTime,
              sessionEndTime: existingEndTime
            }));
            
            // Grant access with remaining time
            try {
              const response = await fetch(`http://192.168.1.1:8080/grant-time?duration=${remaining}`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
              });
              
              if (response.ok) {
                const responseData = await response.json();
                console.log("✅ Access granted for existing session:", responseData);
              }
            } catch (error) {
              console.error("⚠️ Failed to grant access for existing session:", error);
            }
          }
          // PRIORITY 2: Handle saved time restoration (only if no active session)
          else if (savedRemainingTime > 0 && (!data.sessionEndTime || data.sessionEndTime <= Date.now())) {
            let totalTimeSeconds = 0;
            let shouldGrantGrace = false;
            
            if (isNewDay && canGrantGracePeriod) {
              // New day + grace period available: Add saved time to grace period
              totalTimeSeconds = savedRemainingTime + 300; // Saved time + 5 min grace
              shouldGrantGrace = true;
              console.log(`🔄 New day + grace available: Adding ${savedRemainingTime}s saved time to 5-min grace period = ${totalTimeSeconds}s total`);
            } else if (isNewDay && !canGrantGracePeriod) {
              // New day but grace period already used: Restore saved time only
              totalTimeSeconds = savedRemainingTime;
              shouldGrantGrace = false;
              console.log(`🔄 New day but grace used: Restoring ${savedRemainingTime}s saved time only (no grace added)`);
            } else if (!isNewDay) {
              // Same day: Use saved time directly
              totalTimeSeconds = savedRemainingTime;
              shouldGrantGrace = false;
              console.log(`🔄 Same day: Restoring ${savedRemainingTime}s saved time`);
            }
            
            // Only proceed if we have time to restore
            if (totalTimeSeconds > 0) {
              try {
                // Call Orange Pi API with total time
                const restoreResponse = await fetch(`http://192.168.1.1:8080/grant-time?duration=${totalTimeSeconds}`, {
                  method: 'GET',
                  signal: AbortSignal.timeout(5000)
                });
                
                if (restoreResponse.ok) {
                  const responseData = await restoreResponse.json();
                  console.log("✅ Saved time restored:", responseData);
                  
                  // Calculate start and end time
                  const now = Date.now();
                  const startTime = now; // Session starts now
                  const endTime = now + (totalTimeSeconds * 1000);
                  
                  // Update Firestore
                  const updateData = {
                    sessionStartTime: startTime, // Store actual start time
                    sessionEndTime: endTime,
                    savedRemainingTimeSeconds: null, // Clear saved time (it's now active)
                    savedTimeDate: null, // Clear saved date
                    lastLogin: serverTimestamp(),
                    updatedAt: serverTimestamp(),
                  };
                  
                  if (shouldGrantGrace) {
                    updateData.lastGracePeriodDate = today; // Record grace period granted
                  }
                  
                  await Promise.race([
                    updateDoc(userDocRef, updateData),
                    timeoutPromise
                  ]);
                  
                  // Update local state
                  setSessionStartTime(startTime);
                  setSessionEndTime(endTime);
                  setActiveTimeRemaining(totalTimeSeconds);
                  setHasActiveTime(true);
                  setIsSessionActive(true);
                  
                  // Save to sessionStorage
                  sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
                    rfid: rfidFromUrl,
                    sessionStartTime: startTime,
                    sessionEndTime: endTime
                  }));
                  
                  // Show modal with restored time info
                  setRestoredTimeSeconds(savedRemainingTime);
                  setShowTimeRestoredModal(true);
                  
                  console.log(`💾 Restored ${totalTimeSeconds}s (${savedRemainingTime}s saved + ${shouldGrantGrace ? '300s grace' : '0s grace'})`);
                  
                  // Skip grace period grant since we already handled it
                  setLoading(false);
                  return;
                } else {
                  console.error("⚠️ Failed to restore saved time - API returned error");
                }
              } catch (error) {
                console.error("⚠️ Failed to restore saved time:", error);
                // Continue to normal grace period logic
              }
            }
          }
          
          // Grant 5-minute grace period internet access (ONLY ONCE PER DAY and NO ACTIVE SESSION)
          if (canGrantGracePeriod && (!data.sessionEndTime || data.sessionEndTime <= Date.now())) {
            try {
              // Call new endpoint - Orange Pi auto-detects client IP!
              const graceResponse = await fetch(`http://192.168.1.1:8080/grant-time?duration=300`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
              });
              
              if (graceResponse.ok) {
                const responseData = await graceResponse.json();
                console.log("✅ 5-minute grace period internet granted:", responseData);
                
                // Set start and end time
                const startTime = Date.now(); // Session starts now
                const endTime = startTime + (300 * 1000); // 5 minutes from now
                
                // Update Firestore with today's date AND session timestamps
                await Promise.race([
                  updateDoc(userDocRef, {
                    lastLogin: serverTimestamp(),
                    lastGracePeriodDate: today, // Record today's date
                    sessionStartTime: startTime, // Save session start timestamp
                    sessionEndTime: endTime, // Save session end timestamp
                    updatedAt: serverTimestamp(),
                  }),
                  timeoutPromise
                ]);
                
                setSessionStartTime(startTime);
                setSessionEndTime(endTime);
                setHasActiveTime(true);
                setActiveTimeRemaining(300); // 5 minutes
                setIsSessionActive(true);
                
                // Save session to sessionStorage so user can return from portal
                sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
                  rfid: rfidFromUrl,
                  sessionStartTime: startTime,
                  sessionEndTime: endTime
                }));
                console.log("💾 Session saved to storage and Firestore");
                
                console.log("✅ Grace period granted and recorded for", today);
              } else {
                console.error("⚠️ Failed to grant grace period - API returned error");
              }
            } catch (error) {
              console.error("⚠️ Failed to grant grace period internet:", error);
              // Continue anyway - user can still purchase time
            }
          } else {
            // Grace period already used today - just update last login
            await Promise.race([
              updateDoc(userDocRef, {
                lastLogin: serverTimestamp(),
                updatedAt: serverTimestamp(),
              }),
              timeoutPromise
            ]);
            console.log("ℹ️ Grace period already used today. User must purchase time.");
          }

          setLoading(false);
        } else {
          console.log("User not found, redirecting...");
          router.push("/");
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
        router.push("/");
      }
    };

    fetchUserData();
  }, [rfidFromUrl, router]);

  // --- FETCH TOP-UP REQUESTS AND COMBINE WITH TRANSACTIONS ---
  useEffect(() => {
    const fetchTopUpRequests = async () => {
      if (!rfidFromUrl) return;

      try {
        // Query top-up requests for this user
        const q = query(
          collection(db, "topup_requests"),
          where("userId", "==", rfidFromUrl),
          orderBy("requestedAt", "desc")
        );

        const querySnapshot = await getDocs(q);
        
        const topUpRequests = [];
        querySnapshot.forEach((doc) => {
          const data = doc.data();
          
          // Map to transaction format
          let transactionType;
          if (data.status === "pending") {
            transactionType = TRANSACTION_TYPE.TOP_UP_PENDING;
          } else if (data.status === "approved") {
            transactionType = TRANSACTION_TYPE.TOP_UP_APPROVED;
          } else if (data.status === "rejected") {
            transactionType = TRANSACTION_TYPE.TOP_UP_REJECTED;
          }
          
          topUpRequests.push({
            id: doc.id,
            type: transactionType,
            amount: data.amount,
            date: data.requestedAt?.toDate() || new Date(),
            status: data.status,
            referenceId: data.referenceId,
            receiptURL: data.receiptURL,
            isTopUpRequest: true, // Flag to identify top-up requests
          });
        });

        // Merge with existing transactions (top-up requests shown first)
        setTransactionHistory(prev => {
          // Combine and sort by date
          const combined = [...topUpRequests, ...prev];
          return combined.sort((a, b) => b.date - a.date);
        });

        console.log(`✅ Fetched ${topUpRequests.length} top-up request(s)`);
      } catch (error) {
        console.error("Error fetching top-up requests:", error);
      }
    };

    if (!loading) {
      fetchTopUpRequests();
    }
  }, [rfidFromUrl, loading]);

  // --- LISTEN FOR REFUNDS AND RECALCULATE TIME ---
  useEffect(() => {
    if (!rfidFromUrl || !userData) return;

    const checkForRefundAndUpdateTime = async () => {
      try {
        // Get current user data to check sessionEndTime
        const userDocRef = doc(db, "users", rfidFromUrl);
        const userSnap = await getDoc(userDocRef);
        if (!userSnap.exists()) return;
        
        const currentData = userSnap.data();
        const currentSessionEndTime = currentData.sessionEndTime;
        const now = Date.now();
        
        // Check if sessionEndTime was updated (likely due to refund)
        // Compare with local state to detect changes
        if (currentSessionEndTime && currentSessionEndTime > now) {
          const currentRemaining = Math.floor((currentSessionEndTime - now) / 1000);
          const localRemaining = activeTimeRemaining;
          
          // If there's a significant difference (more than 10 seconds), update
          if (Math.abs(currentRemaining - localRemaining) > 10) {
            console.log("🔄 Refund detected - sessionEndTime changed in Firestore");
            console.log(`   Local remaining: ${Math.floor(localRemaining / 60)} min, Firestore remaining: ${Math.floor(currentRemaining / 60)} min`);
            
            // Update local state to match Firestore
            const existingStartTime = currentData.sessionStartTime || now;
            setSessionStartTime(existingStartTime);
            setSessionEndTime(currentSessionEndTime);
            setActiveTimeRemaining(currentRemaining);
            setHasActiveTime(true);
            setIsSessionActive(true);
            
            // Grant access with updated remaining time
            try {
              const response = await fetch(`http://192.168.1.1:8080/grant-time?duration=${currentRemaining}`, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
              });
              
              if (response.ok) {
                const responseData = await response.json();
                console.log("✅ Access granted after refund:", responseData);
              }
            } catch (error) {
              console.error("⚠️ Failed to grant access after refund:", error);
            }
          }
        }
      } catch (error) {
        // Suppress network errors in captive portal environment
        if (error?.code === 'unavailable' || error?.message?.includes('ERR_INTERNET_DISCONNECTED') || error?.message?.includes('Failed to fetch')) {
          // Silently handle network errors - expected in captive portal
          return;
        }
        console.error("Error checking for refunds:", error);
      }
    };

    // Check every 5 seconds for refunds
    const interval = setInterval(checkForRefundAndUpdateTime, 5000);
    
    return () => clearInterval(interval);
  }, [rfidFromUrl, userData, activeTimeRemaining]);

  // --- TIMESTAMP-BASED TIME COUNTDOWN (Accurate even when tab is backgrounded!) ---
  useEffect(() => {
    if (!hasActiveTime || !sessionEndTime) {
      return;
    }

    const updateRemainingTime = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.floor((sessionEndTime - now) / 1000));
      
      setActiveTimeRemaining(remaining);
      
        if (remaining <= 0) {
          // Time expired!
          console.log("⏰ Purchased time expired");
          
          // Save session history to session_history collection before clearing
          const actualSessionStartTime = sessionStartTime || (sessionEndTime ? new Date(sessionEndTime - ((sessionEndTime - (sessionStartTime || sessionEndTime)) / 1000) * 1000) : new Date());
          const sessionEndTimeDate = new Date();
          const actualDuration = actualSessionStartTime ? Math.floor((sessionEndTimeDate - actualSessionStartTime) / 1000) : 0;
          
          const sessionHistoryData = {
            userId: rfidFromUrl,
            userName: userData?.fullName || "Unknown",
            sessionStartTime: actualSessionStartTime,
            sessionEndTime: sessionEndTimeDate,
            durationSeconds: actualDuration,
            timeRemainingSeconds: 0,
            timeRemainingMinutes: 0,
            action: "expired",
            savedForNextSession: false,
            timestamp: serverTimestamp(), // For ordering in queries
            createdAt: serverTimestamp(),
          };
          
          addDoc(collection(db, "session_history"), sessionHistoryData)
            .then(ref => console.log("✅ Session history saved (expired):", ref.id))
            .catch(err => console.error("Error saving session history:", err));
          
          setHasActiveTime(false);
          setIsSessionActive(false);
          setSessionStartTime(null);
          setSessionEndTime(null);
          setShowSessionExpiredModal(true);
          
          // Clear session from storage AND Firestore
          sessionStorage.removeItem('ezvendo_active_session');
          
          // Clear from Firestore
          const userDocRef = doc(db, "users", rfidFromUrl);
          updateDoc(userDocRef, {
            sessionStartTime: null,
            sessionEndTime: null,
          }).catch(err => console.error("Error clearing session from Firestore:", err));
          
          console.log("🗑️ Session cleared from storage and Firestore");
        }
    };

    // Update immediately
    updateRemainingTime();
    
    // Then update every second
    const timeTimer = setInterval(updateRemainingTime, 1000);

    return () => clearInterval(timeTimer);
  }, [hasActiveTime, sessionEndTime]);

  // Elapsed Time Loop (Runs constantly)
  useEffect(() => {
    const elapsedLoop = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(elapsedLoop);
  }, []);

  // Low Credit Warning Display Logic (Debounced)
  useEffect(() => {
    let timer;
    if (isWarningLevel) {
      timer = setTimeout(() => {
        setShowLowCreditWarning(true);
      }, 500);
    } else if (!isWarningLevel) {
      setShowLowCreditWarning(false);
    }
    return () => clearTimeout(timer);
  }, [isWarningLevel]);

  // Redirection Logic (Session Expired, End Session Success, and Stop Confirmed)
  useEffect(() => {
    if (showSessionExpiredModal || showEndSessionSuccess || showStopSuccess) {
      const redirectTimer = setTimeout(() => {
        router.push("/");
      }, 3000);
      return () => clearTimeout(redirectTimer);
    }
  }, [showSessionExpiredModal, showEndSessionSuccess, showStopSuccess, router]);

  // Utilities
  const recentTransactions = transactionHistory.slice(0, 3);

  const formatDate = (date) => {
    const options = { month: "short", day: "numeric" };
    return date.toLocaleDateString("en-US", options);
  };

  const formatModalDate = (date) => {
    const options = {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hour12: true,
    };
    return date.toLocaleDateString("en-US", options);
  };

  const formatTime = (totalSeconds, showHours = false) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (showHours || hours > 0) {
      return `${hours < 10 ? "0" : ""}${hours}:${
        minutes < 10 ? "0" : ""
      }${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
    }
    return `${minutes < 10 ? "0" : ""}${minutes}:${
      seconds < 10 ? "0" : ""
    }${seconds}`;
  };

  const getTimerColor = () => {
    // Color based on remaining balance/time
    if (timeRemainingMinutes > 5) {
      return "rgb(16, 185, 129)"; // green-500 (>5 minutes)
    } else if (timeRemainingMinutes > 2) {
      return "rgb(234, 179, 8)"; // yellow-500 (2-5 minutes)
    } else {
      return "rgb(239, 68, 68)"; // red-500 (<2 minutes)
    }
  };

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

  const knownPulsingClasses = [
    "bg-green-200",
    "bg-green-300",
    "bg-red-200",
    "bg-red-300",
    "bg-gray-100",
    "bg-gray-200",
  ];

  // Show loading state while fetching data
  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500"></div>
          <span className="text-gray-500">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  // If no user data after loading, show error (shouldn't reach here due to redirects)
  if (!userData) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <span className="text-gray-500">User not found</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="min-h-dvh flex flex-col text-sm sm:text-base relative max-w-md mx-auto w-full">
        <div className="flex flex-1 flex-col px-3 py-4 sm:p-4 gap-4">
        {/* Welcome Card - Matching Home Design */}
        <div className="flex relative rounded-2xl bg-linear-to-r from-green-500 via-green-400 to-green-500 p-5 text-white">
          <div className="flex flex-1 flex-col gap-2">
            <span className="text-2xl sm:text-3xl font-bold">
              Hello, {userData?.firstName || userData?.fullName?.split(" ")[0] || "User"}
            </span>
            <div className="flex flex-col">
              <span className="text-sm sm:text-base font-semibold text-white">
                RFID: {userData?.rfidCardId || "N/A"}
              </span>
            </div>
          </div>
          <div className="absolute top-3 right-3 rounded-full p-3 bg-green-600/40 shadow-green-600/40">
            <BanknoteArrowUp className="size-6 sm:size-7" />
          </div>
        </div>

        {/* Balance Card */}
        <div className="flex flex-col gap-2">
          <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
            Account Balance
          </span>
          
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-300 flex items-center justify-between">
            <div className="flex flex-col gap-1">
              <span className="text-xs sm:text-sm text-gray-500">Current Balance</span>
              <span className="text-2xl sm:text-3xl font-bold text-green-600">
                ₱{userBalance.toFixed(2)}
              </span>
            </div>
            <button
              onClick={handleTopUp}
              className="rounded-lg border border-green-500 bg-green-500 hover:bg-green-600 active:bg-green-700 cursor-pointer transition-colors duration-150 p-3 text-white"
            >
              <Plus className="size-5 sm:size-6" />
            </button>
          </div>
        </div>

        {/* Time Remaining Card */}
        {hasActiveTime && (
          <div className="flex flex-col gap-2">
            <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
              Active Session
            </span>
            
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-300 flex flex-col gap-4">
              <div className="flex flex-col items-center justify-center gap-2">
                <span className="text-xs sm:text-sm text-gray-500">Time Remaining</span>
                <span className="font-bold text-4xl sm:text-5xl text-green-500 tabular-nums">
                  {formatTime(activeTimeRemaining)}
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Internet active
                </span>
              </div>
              {/* End Session Button */}
              <button
                onClick={handleEndSession}
                className="flex items-center justify-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 active:bg-orange-700 text-white rounded-lg text-sm font-semibold transition-colors duration-150"
              >
                <Clock className="size-4" />
                End Session & Save Time
              </button>
            </div>
          </div>
        )}
        
        {/* Time Package Buttons */}
        <div className="flex flex-col gap-2">
          <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
            {hasActiveTime ? "Add More Time" : "Purchase Internet Time"}
          </span>
          
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-300 flex flex-col gap-4">
            <div className="text-center">
              <span className="font-semibold text-base">
                Time Packages
              </span>
              <p className="text-xs text-gray-500 mt-1">
                Select a time package (₱{billingRatePerMinute.toFixed(2)}/min)
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {/* 5 Minutes */}
              <button
                onClick={() => handleTimePackageClick(5)}
                disabled={userBalance < (5 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors duration-150 border border-green-600"
              >
                <span className="text-2xl font-bold">5</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1 font-semibold">₱{(5 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 10 Minutes */}
              <button
                onClick={() => handleTimePackageClick(10)}
                disabled={userBalance < (10 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-lg bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors duration-150 border border-green-600"
              >
                <span className="text-2xl font-bold">10</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1 font-semibold">₱{(10 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 30 Minutes */}
              <button
                onClick={() => handleTimePackageClick(30)}
                disabled={userBalance < (30 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors duration-150 border border-blue-600"
              >
                <span className="text-2xl font-bold">30</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1 font-semibold">₱{(30 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 60 Minutes */}
              <button
                onClick={() => handleTimePackageClick(60)}
                disabled={userBalance < (60 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-lg bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors duration-150 border border-blue-600"
              >
                <span className="text-2xl font-bold">60</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1 font-semibold">₱{(60 * billingRatePerMinute).toFixed(2)}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Billing Rate Info */}
        <div className="flex flex-col gap-2">
          <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
            Billing Information
          </span>
          
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-300">
            <div className="flex items-center justify-center">
              <span className="text-gray-600 text-sm">
                Billing rate: <span className="font-semibold text-gray-800">₱{billingRatePerMinute.toFixed(2)} / min</span>
              </span>
            </div>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex flex-col gap-2">
          <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
            Quick Actions
          </span>
          
          <div className="flex items-center gap-3">
            {/* Transactions Button */}
            <Link
              href={`/transactions?rfid=${encodeURIComponent(rfidFromUrl)}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-green-500 hover:bg-green-600 active:bg-green-700 text-white rounded-lg text-sm font-semibold transition-colors duration-150"
            >
              <ScrollText className="size-4" />
              Transactions
            </Link>
            
            {/* Session History Button */}
            <Link
              href={`/session-history?rfid=${encodeURIComponent(rfidFromUrl)}`}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-blue-500 hover:bg-blue-600 active:bg-blue-700 text-white rounded-lg text-sm font-semibold transition-colors duration-150"
            >
              <Clock className="size-4" />
              Sessions
            </Link>
          </div>
        </div>

        {/* Back to Portal Button */}
        <div className="flex flex-col gap-2">
          <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
            Navigation
          </span>
          
          <button
            onClick={() => router.push("/")}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-gray-500 hover:bg-gray-600 active:bg-gray-700 text-white rounded-lg text-sm font-semibold transition-colors duration-150"
          >
            <ChevronRight className="size-4 rotate-180" />
            Back to Portal
          </button>
        </div>
        </div>
      </div>

      {/* Modal for No credits */}
      {/* COMMENTED OUT - Users have grace period, no need to block immediately */}
      {/* {showNoCreditModal && (
        <div className="flex min-h-screen flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-40">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-red-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <BanknoteX className="text-red-500 size-6 sm:size-7" />
            </div>
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold">
                  No Available Credits
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Please add funds to your account first
                </span>
              </div>
            </div>

            <button
              onClick={handleTopUp}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-500/90 hover:bg-green-500/90  active:border-green-600 active:bg-green-600 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              Top-up instructions
            </button>
          </div>
        </div>
      )} */}
      {/* Modal for Top-up Request Form */}
      {showTopUpInstructions && (
        <div 
          className={`fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-50 overflow-y-auto transition-opacity duration-300 ${
            isTopUpModalClosing ? "opacity-0" : "opacity-100"
          }`}
          onClick={closeTopUpModal}
        >
          <div 
            className={`rounded-2xl relative bg-white w-full max-w-5xl flex flex-col gap-3 mt-2 mb-2 transition-all duration-300 ease-in-out ${
              isTopUpModalClosing 
                ? "translate-y-[150vh] opacity-0 scale-95" 
                : isTopUpModalOpening
                ? "translate-y-0 opacity-100 scale-100"
                : "translate-y-[20px] opacity-0 scale-[0.95]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* CLOSE BUTTON - Top Middle */}
            <button
              onClick={closeTopUpModal}
              className="absolute top-[-16px] left-1/2 transform -translate-x-1/2 z-10 p-2 cursor-pointer rounded-full bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-150 text-gray-600 shadow-lg"
              disabled={isSubmittingTopUp}
            >
              <ChevronDown className="size-5 sm:size-6" />
            </button>

            {topUpSuccess ? (
              // Success State
              <>
                {/* HEADER CARD - Success State */}
                <div className="flex relative rounded-t-2xl p-4 sm:p-5 text-white bg-linear-to-r from-green-500 via-green-400 to-green-500">
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-xl sm:text-2xl font-bold">
                      Request Submitted!
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs sm:text-sm font-semibold text-white">
                        Top-Up Request
                      </span>
                      <span className="text-xs text-gray-100">
                        Your request has been sent to the admin for approval
                      </span>
                    </div>
                  </div>
                  <div className="absolute top-3 right-3 rounded-full p-2.5 sm:p-3 bg-green-600/40 shadow-green-600/40">
                    <CheckCircle className="size-5 sm:size-6" />
                  </div>
                </div>

                {/* MAIN CONTENT - Success */}
                <div className="flex flex-col gap-3 p-4 sm:p-5">
                  <div className="flex flex-col items-center justify-center gap-4 py-4">
                    <div className="rounded-full p-3 bg-green-500 text-white">
                      <CheckCircle className="size-6 sm:size-7" />
                    </div>
                    <div className="flex flex-col text-center gap-1">
                      <span className="text-base sm:text-lg font-semibold text-green-600">
                        Success
                      </span>
                      <span className="text-gray-500 text-xs sm:text-sm">
                        Your top-up request has been sent to the admin for approval
                      </span>
                    </div>
                  </div>

                  <button
                    onClick={closeTopUpModal}
                    className="w-full bg-green-500 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:bg-green-500/90 active:bg-green-600 transition-colors duration-150 cursor-pointer"
                  >
                    OK
                  </button>
                </div>
              </>
            ) : (
              // Form State
              <>
                {/* HEADER CARD - Matching Purchase Confirmation Design */}
                <div className="flex relative rounded-t-2xl p-4 sm:p-5 text-white bg-linear-to-r from-blue-500 via-blue-400 to-blue-500">
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-xl sm:text-2xl font-bold">
                      Top-Up Request
                    </span>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-xs sm:text-sm font-semibold text-white">
                        Request Form
                      </span>
                      <span className="text-xs text-gray-100">
                        Fill out the form below after sending payment
                      </span>
                    </div>
                  </div>
                  <div className="absolute top-3 right-3 rounded-full p-2.5 sm:p-3 bg-blue-600/40 shadow-blue-600/40">
                    <BanknoteArrowUp className="size-5 sm:size-6" />
                  </div>
                </div>

                {/* MAIN CONTENT */}
                <div className="flex flex-col gap-3 p-4 sm:p-5 max-h-[70vh] overflow-y-auto">
                  {/* Payment Method Selection */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-gray-500">
                      Payment Method <span className="text-red-500">*</span>
                    </span>
                    <select
                      value={topUpPaymentMethod}
                      onChange={(e) => setTopUpPaymentMethod(e.target.value)}
                      className="px-3 sm:px-4 py-2 w-full border border-gray-300 outline-none rounded-lg focus:border-green-500 placeholder:text-gray-500 transition-colors duration-150"
                      disabled={isSubmittingTopUp}
                    >
                      <option value="MAYA">MAYA</option>
                      <option value="GCASH">GCASH</option>
                      <option value="MARIBANK">MARIBANK</option>
                      <option value="GOTYME">GOTYME</option>
                    </select>
                  </div>

                  {/* Payment Info */}
                  <div className="flex flex-col gap-2 p-2.5 sm:p-3 rounded-lg border border-blue-300 bg-blue-50">
                    <span className="text-xs sm:text-sm font-semibold text-blue-900">Send payment to:</span>
                    <div className="flex flex-col gap-1">
                      <span className="text-xs text-gray-800">
                        <span className="font-semibold">{topUpPaymentMethod}:</span> {PAYMENT_METHODS[topUpPaymentMethod]?.number}
                      </span>
                      <span className="text-xs text-gray-800">
                        <span className="font-semibold">Name:</span> {PAYMENT_METHODS[topUpPaymentMethod]?.name}
                      </span>
                    </div>
                  </div>

                  {/* Form Fields Section */}
                  <div className="flex flex-col gap-2">
                    <span className="text-xs sm:text-sm font-semibold text-gray-500">
                      Request Details
                    </span>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                      {/* Amount */}
                      <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                        <span className="text-gray-500 text-xs mb-0.5">
                          Amount (₱) <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="number"
                          value={topUpAmount}
                          onChange={(e) => setTopUpAmount(e.target.value)}
                          placeholder="e.g. 100"
                          min="1"
                          step="0.01"
                          className="font-semibold text-xs sm:text-sm border-0 outline-none bg-transparent p-0"
                          disabled={isSubmittingTopUp}
                        />
                      </div>

                      {/* Reference ID */}
                      <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                        <span className="text-gray-500 text-xs mb-0.5">
                          {topUpPaymentMethod} Reference ID <span className="text-red-500">*</span>
                        </span>
                        <input
                          type="text"
                          value={topUpReferenceId}
                          onChange={(e) => setTopUpReferenceId(e.target.value)}
                          placeholder="Enter reference number"
                          className="font-semibold text-xs sm:text-sm border-0 outline-none bg-transparent p-0"
                          disabled={isSubmittingTopUp}
                        />
                      </div>
                    </div>

                      {/* Receipt Upload */}
                      <div className="flex flex-col gap-2 p-2.5 sm:p-3 rounded-lg border border-gray-300">
                        <span className="text-gray-500 text-xs mb-0.5">
                          Payment Receipt <span className="text-red-500">*</span>
                        </span>
                        <input
                          id="receipt-upload-input"
                          type="file"
                          accept="image/*"
                          onChange={handleReceiptUpload}
                          className="text-xs sm:text-sm text-gray-600 file:mr-4 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-green-50 file:text-green-700 hover:file:bg-green-100"
                          disabled={isSubmittingTopUp}
                        />
                        {topUpReceiptPreview && (
                          <div className="mt-2 relative rounded-lg overflow-hidden border border-gray-300 group">
                            {/* Remove Button */}
                            <button
                              onClick={handleRemoveReceipt}
                              disabled={isSubmittingTopUp}
                              className="absolute top-2 right-2 z-10 p-1.5 rounded-full bg-red-500 text-white hover:bg-red-600 active:bg-red-700 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                              title="Remove receipt"
                            >
                              <X className="size-4" />
                            </button>
                            
                            {/* Clickable Receipt Preview */}
                            <div
                              onClick={handleReceiptPreviewClick}
                              className="cursor-pointer hover:opacity-90 transition-opacity duration-150"
                            >
                              <img
                                src={topUpReceiptPreview}
                                alt="Receipt preview"
                                className="w-full h-48 object-contain"
                              />
                              {/* Overlay hint */}
                              <div className="absolute inset-0 flex items-center justify-center bg-black/0 group-hover:bg-black/10 transition-colors duration-150">
                                <span className="text-white text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity duration-150 bg-black/50 px-3 py-1.5 rounded-lg">
                                  Click to preview
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      onClick={handleSubmitTopUp}
                      disabled={isSubmittingTopUp}
                      className="w-full bg-green-500 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:bg-green-500/90 active:bg-green-600 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                    >
                      {isSubmittingTopUp ? (
                        <>
                          <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          Uploading...
                        </>
                      ) : (
                        "Submit Request"
                      )}
                    </button>
                    <button
                      onClick={handleCancelTopUp}
                      disabled={isSubmittingTopUp}
                      className="w-full bg-gray-500 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:bg-gray-500/90 active:bg-gray-600 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {/* Modal for Low Credit Warning (Persistent) */}
      {/* COMMENTED OUT - Not needed during grace period, will show when balance is actually low */}
      {/* {showLowCreditWarning && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-yellow-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <TriangleAlert className="text-yellow-400 size-6 sm:size-7" />
            </div>

            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold">
                  Low Credits
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Your available credits (P{userBalance.toFixed(2)}) are low.
                  Top-up again to ensure uninterrupted session.
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 w-full">
              <button
                onClick={handleWarningDismiss}
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 text-green-500 hover:bg-green-500 hover:text-white active:bg-green-600 active:border-green-600 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Do it later
              </button>

              <button
                onClick={handleTopUp}
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Top-up
              </button>
            </div>
          </div>
        </div>
      )} */}
      {/* Modal for Session Expired/Insufficient Funds */}
      {showSessionExpiredModal && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-40">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-red-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <TimerOff className="text-red-500 size-6 sm:size-7" />
            </div>
            <div className="flex flex-col items-center justify-center gap-2 ">
              <div className="flex flex-col gap-3">
                <div className="flex flex-col text-center">
                  <span className="text-base sm:text-lg font-semibold">
                    Session Expired
                  </span>
                  <span className="text-gray-500 text-xs sm:text-sm">
                    Connect again by tapping your RFID Card
                  </span>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-center py-2">
              <span className="text-gray-500 text-xs sm:text-sm animate-pulse">
                Redirecting to portal...
              </span>
            </div>
            
            {/* Back to Portal Button */}
            <button
              onClick={() => router.push("/")}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              <ChevronRight className="size-4 rotate-180" />
              Back to Portal
            </button>
          </div>
        </div>
      )}
      {/* Modal for Stop Session Confirmation */}
      {showStopConfirm && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-yellow-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <CircleStop className="text-yellow-400 size-6 sm:size-7" />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="flex flex-col text-center">
                  <span className="text-base sm:text-lg font-semibold">
                    Stop Session Confirmation
                  </span>
                  <span className="text-gray-500 text-xs sm:text-sm">
                    Are you sure you want to stop the session?
                  </span>
                </div>
              </div>
              {/* time used */}
              <div className="flex items-center justify-center py-2">
                <span className="text-gray-500 text-sm sm:text-base">
                  Time used:{" "}
                  <span className="font-semibold">
                    {formatTime(elapsedSeconds)}
                  </span>
                </span>
              </div>
            </div>
            {/* buttons */}
            <div className="flex items-center gap-2 w-full">
              <button
                onClick={finalizeStopSession} // ⬅️ Confirms and proceeds to success modal
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 text-green-500 hover:bg-green-500 hover:text-white active:bg-green-600 active:border-green-600 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Confirm
              </button>

              <button
                onClick={handleContinueSession} // ⬅️ Closes modal and resumes
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal for Post-Stop Session */}
      {showStopSuccess && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-green-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <CheckCircle className="text-green-500 size-6 sm:size-7" />
            </div>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col items-center justify-center gap-2">
                <div className="flex flex-col text-center">
                  <span className="text-base sm:text-lg font-semibold">
                    Stop Session Confirmed
                  </span>
                  <span className="text-gray-500 text-xs sm:text-sm">
                    You're remaining credits are{" "}
                    <span className="font-semibold">
                      P{userBalance.toFixed(2)}.
                    </span>{" "}
                    Tap your RFID card to continue.
                  </span>
                </div>
              </div>
              {/* remaining time */}
              <div className="flex items-center justify-center py-2">
                <span className="text-gray-500 text-xs sm:text-sm animate-pulse">
                  Redirecting to portal...
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Modal for Transaction Details */}
      {selectedTransaction && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            {(() => {
              // Get details for the *selected* transaction
              const {
                Icon,
                SignIcon,
                colorClass,
                bgColorClass,
              } = getTransactionDetails(selectedTransaction.type);

              return (
                <>
                  <div
                    className={`size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50 ${
                      colorClass.includes("green")
                        ? "bg-green-100"
                        : colorClass.includes("orange")
                        ? "bg-orange-100"
                        : "bg-red-100"
                    }`}
                  >
                    <Icon className={`size-6 sm:size-7 ${colorClass}`} />
                  </div>
                  <div className="flex flex-col items-center justify-center gap-2 ">
                    <div className="flex flex-col text-center gap-2">
                      <span className="text-base sm:text-lg font-semibold">
                        {selectedTransaction.type}
                      </span>
                      {/* Status Badge */}
                      {selectedTransaction.isTopUpRequest && (
                        <div className="flex justify-center">
                          {selectedTransaction.status === "pending" && (
                            <span className="text-xs px-3 py-1 rounded-full bg-orange-100 text-orange-700 font-semibold border border-orange-300">
                              ⏳ Pending Review
                            </span>
                          )}
                          {selectedTransaction.status === "approved" && (
                            <span className="text-xs px-3 py-1 rounded-full bg-green-100 text-green-700 font-semibold border border-green-300">
                              ✓ Approved
                            </span>
                          )}
                          {selectedTransaction.status === "rejected" && (
                            <span className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-700 font-semibold border border-red-300">
                              ✗ Rejected
                            </span>
                          )}
                        </div>
                      )}
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
            <div className="flex flex-col gap-3 w-full">
              <div className="flex w-full items-center justify-between rounded-lg p-4 bg-gray-100">
                {/* left */}
                <div className="flex flex-col">
                  <span className="text-xs sm:text-sm font-semibold">
                    {userData.fullName}
                  </span>
                  <span className="text-xs sm:text-sm text-gray-500">
                    {userData.rfidCardId}
                  </span>
                </div>
                {/* right */}
                <div className="flex flex-col">
                  <span className="text-xs sm:text-sm font-semibold">
                    Transaction ID:
                  </span>
                  <span className="text-xs sm:text-sm text-gray-500">
                    {selectedTransaction.id}
                  </span>
                </div>
              </div>
              
              {/* Additional info for top-up requests */}
              {selectedTransaction.isTopUpRequest && (
                <>
                  {/* Reference ID */}
                  <div className="flex flex-col gap-1 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <span className="text-xs font-semibold text-gray-700">GCash Reference ID:</span>
                    <span className="text-sm text-gray-800 font-mono">{selectedTransaction.referenceId}</span>
                  </div>
                  
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
            </div>
            
            {/* close specific transaction log modal */}
            <button
              onClick={() => setSelectedTransaction(null)} // ⬅️ Close modal handler
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      {/* Modal for Zero Balance - Informational */}
      {showZeroBalanceModal && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-orange-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <TriangleAlert className="text-orange-500 size-6 sm:size-7" />
            </div>
            
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold">
                  Balance is Zero
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  You currently have no balance in your account.
                </span>
              </div>
            </div>

            {/* Information Box */}
            <div className="flex flex-col gap-3 p-4 bg-green-50 border border-green-200 rounded-lg w-full">
              <div className="flex items-start gap-2">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">✓</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Free 5-Minute Grace Period</span>
                  <span className="text-gray-600 text-xs">
                    You've been granted 5 minutes of free internet access. Use this time to top up your balance and continue using the service.
                  </span>
                </div>
              </div>
              
              <div className="flex items-start gap-2 pt-2 border-t border-green-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-orange-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">!</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Once Per Day</span>
                  <span className="text-gray-600 text-xs">
                    This grace period is only granted once per day. After it expires, you'll need to purchase time packages to continue.
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowZeroBalanceModal(false)}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              I Understand
            </button>
          </div>
        </div>
      )}
      
      {/* Modal for Time Restored */}
      {showTimeRestoredModal && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-green-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <CheckCircle className="text-green-500 size-6 sm:size-7" />
            </div>
            
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold text-green-600">
                  Time Restored!
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Your saved time has been restored and added to your session.
                </span>
              </div>
            </div>

            {/* Information Box */}
            <div className="flex flex-col gap-3 p-4 bg-green-50 border border-green-200 rounded-lg w-full">
              <div className="flex items-center justify-center gap-2">
                <Clock className="text-green-600 size-5" />
                <span className="font-bold text-lg text-green-600">
                  {formatTime(restoredTimeSeconds)}
                </span>
                <span className="text-gray-600 text-sm">
                  saved time restored
                </span>
              </div>
              
              <div className="flex items-start gap-2 pt-2 border-t border-green-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">+</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Added to Session</span>
                  <span className="text-gray-600 text-xs">
                    {restoredTimeSeconds >= 300 ? 
                      `Your saved time has been combined with today's 5-minute grace period.` :
                      `Your saved time has been added to your current session.`
                    }
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => setShowTimeRestoredModal(false)}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              Got It
            </button>
          </div>
        </div>
      )}
      
      {/* Modal for End Session Confirmation */}
      {showEndSessionConfirm && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-orange-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <Clock className="text-orange-500 size-6 sm:size-7" />
            </div>
            
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold">
                  End Session?
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Your remaining time will be saved for your next visit.
                </span>
              </div>
            </div>

            {/* Information Box */}
            <div className="flex flex-col gap-3 p-4 bg-orange-50 border border-orange-200 rounded-lg w-full">
              <div className="flex items-center justify-center gap-2">
                <Clock className="text-orange-600 size-5" />
                <span className="font-bold text-lg text-orange-600">
                  {formatTime(activeTimeRemaining)}
                </span>
                <span className="text-gray-600 text-sm">
                  remaining time will be saved
                </span>
              </div>
              
              <div className="flex items-start gap-2 pt-2 border-t border-orange-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-orange-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">ℹ️</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Internet will be disconnected</span>
                  <span className="text-gray-600 text-xs">
                    Your internet access will be removed immediately when you confirm.
                  </span>
                </div>
              </div>
            </div>

            {/* Buttons */}
            <div className="flex items-center gap-2 w-full">
              <button
                onClick={() => setShowEndSessionConfirm(false)}
                disabled={isEndingSession}
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Cancel
              </button>
              <button
                onClick={confirmEndSession}
                disabled={isEndingSession}
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-orange-500 bg-orange-500 text-white hover:border-orange-600 hover:bg-orange-600 active:border-orange-700 active:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                {isEndingSession ? (
                  <>
                    <div className="size-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Ending...
                  </>
                ) : (
                  "Confirm"
                )}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Modal for End Session Success */}
      {showEndSessionSuccess && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-green-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <CheckCircle className="text-green-500 size-6 sm:size-7" />
            </div>
            
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold text-green-600">
                  Session Ended Successfully!
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Your remaining time has been saved.
                </span>
              </div>
            </div>

            {/* Information Box */}
            <div className="flex flex-col gap-3 p-4 bg-green-50 border border-green-200 rounded-lg w-full">
              <div className="flex items-center justify-center gap-2">
                <Clock className="text-green-600 size-5" />
                <span className="font-bold text-lg text-green-600">
                  {savedTimeMinutes} {savedTimeMinutes === 1 ? 'minute' : 'minutes'}
                </span>
                <span className="text-gray-600 text-sm">
                  saved for next visit
                </span>
              </div>
              
              <div className="flex items-start gap-2 pt-2 border-t border-green-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">✓</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm">Internet Access Removed</span>
                  <span className="text-gray-600 text-xs">
                    Your internet connection has been disconnected. Your saved time will be available on your next scan.
                  </span>
                </div>
              </div>
            </div>

            {/* Revoke Status Indicator */}
            {!revokeSuccess && (
              <div className="flex items-start gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg w-full">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-yellow-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">!</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm text-yellow-900">Note</span>
                  <span className="text-yellow-800 text-xs">
                    Internet access revocation may have failed, but your time has been saved. You may need to manually disconnect.
                  </span>
                </div>
              </div>
            )}

            <div className="flex items-center justify-center py-2">
              <span className="text-gray-500 text-xs sm:text-sm animate-pulse">
                Redirecting to portal...
              </span>
            </div>
            
            <button
              onClick={() => router.push("/")}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              <ChevronRight className="size-4 rotate-180" />
              Back to Portal
            </button>
          </div>
        </div>
      )}
      
      {/* Modal for End Session Error */}
      {showEndSessionError && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-red-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <X className="text-red-500 size-6 sm:size-7" />
            </div>
            
            <div className="flex flex-col items-center justify-center gap-2">
              <div className="flex flex-col text-center">
                <span className="text-lg sm:text-xl font-semibold text-red-600">
                  Error Ending Session
                </span>
                <span className="text-gray-500 text-xs sm:text-sm mt-2">
                  {endSessionError || "An error occurred while ending your session. Please try again."}
                </span>
              </div>
            </div>

            <button
              onClick={() => {
                setShowEndSessionError(false);
                setEndSessionError("");
              }}
              className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-red-500 bg-red-500 text-white hover:border-red-600 hover:bg-red-600 active:border-red-700 active:bg-red-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
            >
              Close
            </button>
          </div>
        </div>
      )}
      
      {/* Purchase Confirmation Modal */}
      {showPurchaseConfirm && selectedMinutes && (
        <div 
          className={`fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-50 overflow-y-auto transition-opacity duration-300 ${
            isPurchaseModalClosing ? "opacity-0" : "opacity-100"
          }`}
          onClick={closePurchaseConfirmModal}
        >
          <div 
            className={`rounded-2xl relative bg-white w-full max-w-5xl flex flex-col gap-3 mt-2 mb-2 transition-all duration-300 ease-in-out ${
              isPurchaseModalClosing 
                ? "translate-y-[150vh] opacity-0 scale-95" 
                : isPurchaseModalOpening
                ? "translate-y-0 opacity-100 scale-100"
                : "translate-y-[20px] opacity-0 scale-[0.95]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* CLOSE BUTTON - Top Middle */}
            <button
              onClick={closePurchaseConfirmModal}
              className="absolute top-[-16px] left-1/2 transform -translate-x-1/2 z-10 p-2 cursor-pointer rounded-full bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-150 text-gray-600 shadow-lg"
              disabled={isPurchasing}
            >
              <ChevronDown className="size-5 sm:size-6" />
            </button>

            {/* HEADER CARD - Matching User Modal Design */}
            <div className="flex relative rounded-t-2xl p-4 sm:p-5 text-white bg-linear-to-r from-green-500 via-green-400 to-green-500">
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  Confirm Purchase
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs sm:text-sm font-semibold text-white">
                    Time Package: {selectedMinutes} {selectedMinutes === 1 ? 'minute' : 'minutes'}
                  </span>
                  <span className="text-xs text-gray-100">
                    Review your purchase details below
                  </span>
                </div>
              </div>
              <div className="absolute top-3 right-3 rounded-full p-2.5 sm:p-3 bg-green-600/40 shadow-green-600/40">
                <BanknoteArrowUp className="size-5 sm:size-6" />
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              {/* Purchase Details Section */}
              <div className="flex flex-col gap-2">
                <span className="text-xs sm:text-sm font-semibold text-gray-500">
                  Purchase Details
                </span>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
                  <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                    <span className="text-gray-500 text-xs mb-0.5">
                      Time Package
                    </span>
                    <span className="font-semibold text-xs sm:text-sm">
                      {selectedMinutes} {selectedMinutes === 1 ? 'minute' : 'minutes'}
                    </span>
                  </div>

                  <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                    <span className="text-gray-500 text-xs mb-0.5">
                      Cost
                    </span>
                    <span className="font-semibold text-xs sm:text-sm text-green-600">
                      ₱{(selectedMinutes * billingRatePerMinute).toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                    <span className="text-gray-500 text-xs mb-0.5">
                      Current Balance
                    </span>
                    <span className="font-semibold text-xs sm:text-sm">
                      ₱{userBalance.toFixed(2)}
                    </span>
                  </div>

                  <div className="flex flex-col p-2.5 sm:p-3 rounded-lg border border-gray-300">
                    <span className="text-gray-500 text-xs mb-0.5">
                      Balance After Purchase
                    </span>
                    <span className={`font-semibold text-xs sm:text-sm ${
                      (userBalance - (selectedMinutes * billingRatePerMinute)) < 0 
                        ? 'text-red-600' 
                        : 'text-gray-800'
                    }`}>
                      ₱{(userBalance - (selectedMinutes * billingRatePerMinute)).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={() => purchaseTimePackage(selectedMinutes)}
                  disabled={isPurchasing || userBalance < (selectedMinutes * billingRatePerMinute)}
                  className="w-full bg-green-500 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:bg-green-500/90 active:bg-green-600 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isPurchasing ? "Processing..." : "Confirm Purchase"}
                </button>
                <button
                  onClick={closePurchaseConfirmModal}
                  disabled={isPurchasing}
                  className="w-full bg-gray-500 px-4 py-2.5 rounded-lg text-white text-sm font-medium hover:bg-gray-500/90 active:bg-gray-600 transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {/* Purchase Success Modal */}
      {showPurchaseSuccess && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-[70] overflow-y-auto">
          <div className="rounded-2xl bg-white p-4 sm:p-5 w-full max-w-md flex flex-col gap-6 mt-2 mb-2">
            <div className="flex flex-col items-center justify-center gap-4 pt-2">
              <div className="rounded-full p-3 bg-green-500 text-white">
                <CheckCircle2 className="size-6 sm:size-7" />
              </div>
              <div className="flex flex-col text-center gap-1">
                <span className="text-base sm:text-lg font-semibold text-green-500">
                  Success
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  {purchaseMessage}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowPurchaseSuccess(false)}
              className="rounded-lg w-full cursor-pointer px-4 py-2 border border-green-500 bg-green-500 text-white hover:bg-green-500/90 active:bg-green-600 transition-colors duration-150"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Purchase Error Modal */}
      {showPurchaseError && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-[70] overflow-y-auto">
          <div className="rounded-2xl bg-white p-4 sm:p-5 w-full max-w-md flex flex-col gap-6 mt-2 mb-2">
            <div className="flex flex-col items-center justify-center gap-4 pt-2">
              <div className="rounded-full p-3 bg-red-500 text-white">
                <XCircle className="size-6 sm:size-7" />
              </div>
              <div className="flex flex-col text-center gap-1">
                <span className="text-base sm:text-lg font-semibold text-red-500">
                  Error
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  {purchaseMessage}
                </span>
              </div>
            </div>

            <button
              onClick={() => setShowPurchaseError(false)}
              className="rounded-lg w-full cursor-pointer px-4 py-2 border border-red-500 bg-red-500 text-white hover:bg-red-500/90 active:bg-red-600 transition-colors duration-150"
            >
              OK
            </button>
          </div>
        </div>
      )}

      {/* Receipt Preview Modal */}
      {showReceiptPreview && topUpReceiptPreview && (
        <div 
          className="fixed inset-0 bg-black/90 flex items-center justify-center p-4 sm:p-5 z-[60] overflow-y-auto"
          onClick={handleCloseReceiptPreview}
        >
          <div className="relative max-w-7xl max-h-[90vh] w-full flex items-center justify-center">
            {/* Close button */}
            <button
              onClick={handleCloseReceiptPreview}
              className="absolute top-4 right-4 p-2 cursor-pointer rounded-full bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors duration-150 text-white z-10"
            >
              <X className="size-5 sm:size-6" />
            </button>

            {/* Image Container */}
            <div className="relative w-full flex items-center justify-center">
              {receiptPreviewLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 animate-pulse">
                  <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
                </div>
              )}
              <img
                src={topUpReceiptPreview}
                alt="Receipt Preview"
                className={`max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl ${receiptPreviewLoading ? 'opacity-0' : 'opacity-100'} transition-opacity duration-300`}
                onLoad={handleReceiptPreviewImageLoad}
                onError={() => setReceiptPreviewLoading(false)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
