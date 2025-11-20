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
  BanknoteArrowUp,
  TimerOff,
  TriangleAlert,
  CircleStop,
  CheckCircle,
  Minus,
  BanknoteArrowDown,
  WifiOff,
  X,
  Clock,
} from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { db, storage } from "@/app/config/firebase";
import { doc, getDoc, updateDoc, increment, serverTimestamp, setDoc, collection, addDoc, query, where, getDocs, orderBy } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

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
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [showZeroBalanceModal, setShowZeroBalanceModal] = useState(false); // NEW: Show when balance is 0
  
  // Top-up Form States
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpReferenceId, setTopUpReferenceId] = useState("");
  const [topUpReceipt, setTopUpReceipt] = useState(null);
  const [topUpReceiptPreview, setTopUpReceiptPreview] = useState(null);
  const [isSubmittingTopUp, setIsSubmittingTopUp] = useState(false);
  const [topUpSuccess, setTopUpSuccess] = useState(false);

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

      console.log(`💰 Deducted P${amountToDeduct.toFixed(2)} for ${minutesUsed} minutes`);
    } catch (error) {
      console.error("Error stopping session:", error);
    }

    setIsSessionActive(false);
    setElapsedSeconds(0); // Reset elapsed time
    setShowStopConfirm(false);
    setShowStopSuccess(true); // Show success modal (which redirects after 3s)
  };

  const handleContinueSession = () => {
    setShowStopConfirm(false); // Close confirmation modal and resume
  };

  // 4. Top-up / Dismissal Handlers
  const handleTopUp = () => {
    setShowTopUpInstructions(true);
    setShowLowCreditWarning(false)
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

      setShowTopUpInstructions(false);

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

  // Submit top-up request
  const handleSubmitTopUp = async () => {
    // Validation
    if (!topUpAmount || parseFloat(topUpAmount) <= 0) {
      alert("Please enter a valid amount");
      return;
    }
    if (!topUpReferenceId || topUpReferenceId.trim() === "") {
      alert("Please enter the GCash reference ID");
      return;
    }
    if (!topUpReceipt) {
      alert("Please attach your payment receipt");
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
      
      // 3. Save top-up request to Firestore (with URL, not base64!)
      const topUpRequest = {
        userId: rfidFromUrl,
        userName: userData?.fullName || "Unknown",
        userEmail: userData?.email || "N/A",
        amount: parseFloat(topUpAmount),
        referenceId: topUpReferenceId,
        receiptURL: receiptURL, // Download URL from Firebase Storage
        receiptFileName: topUpReceipt.name,
        receiptStoragePath: `receipts/${rfidFromUrl}/${fileName}`, // For admin reference/deletion
        status: "pending", // pending, approved, rejected
        requestedAt: serverTimestamp(),
        paymentMethod: "GCash",
      };

      const requestRef = await addDoc(collection(db, "topup_requests"), topUpRequest);
      console.log("✅ Top-up request submitted:", requestRef.id);

      // Add to transaction history immediately (so user sees it!)
      setTransactionHistory(prev => [{
        id: requestRef.id,
        type: TRANSACTION_TYPE.TOP_UP_PENDING,
        amount: parseFloat(topUpAmount),
        date: new Date(),
        status: "pending",
        referenceId: topUpReferenceId,
        receiptURL: receiptURL,
        isTopUpRequest: true,
      }, ...prev]);

      // Show success state
      setTopUpSuccess(true);
      
      // Reset form after 2 seconds
      setTimeout(() => {
        setTopUpSuccess(false);
        setShowTopUpInstructions(false);
        setTopUpAmount("");
        setTopUpReferenceId("");
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
  const handleCancelTopUp = () => {
    setShowTopUpInstructions(false);
    setTopUpAmount("");
    setTopUpReferenceId("");
    setTopUpReceipt(null);
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

  // --- PURCHASE TIME PACKAGE ---
  const purchaseTimePackage = async (minutes) => {
    const durationSeconds = minutes * 60;
    const cost = minutes * billingRatePerMinute;
    
    // Check if user has sufficient balance
    if (userBalance < cost) {
      alert(`Insufficient balance! You need ₱${cost.toFixed(2)} but only have ₱${userBalance.toFixed(2)}`);
      return;
    }
    
    try {
      console.log(`💰 Purchasing ${minutes} minutes for ₱${cost.toFixed(2)}`);
      
      // Calculate new end time before updating Firestore
      const now = Date.now();
      const newEndTime = sessionEndTime 
        ? sessionEndTime + (durationSeconds * 1000) // Add to existing
        : now + (durationSeconds * 1000); // Start new
      
      // Deduct balance from Firestore AND save sessionEndTime
      const userDocRef = doc(db, "users", rfidFromUrl);
      await updateDoc(userDocRef, {
        balance: increment(-cost),
        sessionEndTime: newEndTime, // Save session end timestamp
        updatedAt: serverTimestamp(),
      });
      
      // Update local balance
      setUserBalance(prev => prev - cost);
      
      // Save transaction to Firebase
      const transactionData = {
        userId: rfidFromUrl,
        type: TRANSACTION_TYPE.DEDUCTION,
        amount: cost,
        minutesPurchased: minutes,
        timestamp: serverTimestamp(),
        description: `Purchased ${minutes} minutes of internet`,
      };
      
      const transactionRef = await addDoc(collection(db, "transactions"), transactionData);
      console.log("✅ Transaction saved to Firestore:", transactionRef.id);
      
      // Add to local transaction history
      setTransactionHistory(prev => [{
        id: transactionRef.id,
        type: TRANSACTION_TYPE.DEDUCTION,
        amount: cost,
        date: new Date(),
        minutesUsed: minutes,
      }, ...prev]);
      
      console.log("✅ Balance deducted, calling Orange Pi API...");
      
      // Calculate TOTAL time (existing + new purchase)
      const totalTimeSeconds = activeTimeRemaining + durationSeconds;
      const totalMinutes = Math.floor(totalTimeSeconds / 60);
      
      console.log(`🌐 Requesting ${totalMinutes} minutes TOTAL (${minutes} min added to ${Math.floor(activeTimeRemaining/60)} min existing)`);
      
      // Call Orange Pi API with TOTAL time
      // Orange Pi will auto-detect client IP from the HTTP request (like ESP32 does!)
      const response = await fetch(`http://192.168.1.1:8080/grant-time?duration=${totalTimeSeconds}`, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log("✅ Internet access granted:", data);
        
        // Use the pre-calculated newEndTime
        setSessionEndTime(newEndTime);
        setHasActiveTime(true);
        setIsSessionActive(true);
        
        // Update session in sessionStorage
        sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
          rfid: rfidFromUrl,
          sessionEndTime: newEndTime
        }));
        console.log("💾 Session updated in storage and Firestore");
        
        const totalMinutes = Math.floor((newEndTime - now) / 60000);
        alert(`✅ ${minutes} minutes added!\nTotal time: ${totalMinutes} minutes`);
      } else {
        console.error("❌ Failed to grant internet access");
        alert("❌ Failed to activate internet. Please try again.");
      }
      
    } catch (error) {
      console.error("❌ Error purchasing time:", error);
      alert("❌ Error purchasing time. Please try again.");
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
        console.error("Error fetching system config:", error);
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
          
          // Restore existing session if it exists and hasn't expired
          if (data.sessionEndTime && data.sessionEndTime > Date.now()) {
            const existingEndTime = data.sessionEndTime;
            const remaining = Math.floor((existingEndTime - Date.now()) / 1000);
            
            console.log("🔄 Restoring existing session from Firestore");
            console.log("   End time:", new Date(existingEndTime).toLocaleString());
            console.log("   Time remaining:", Math.floor(remaining / 60), "minutes");
            
            setSessionEndTime(existingEndTime);
            setActiveTimeRemaining(remaining);
            setHasActiveTime(true);
            setIsSessionActive(true);
            
            // Also save to sessionStorage
            sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
              rfid: rfidFromUrl,
              sessionEndTime: existingEndTime
            }));
          }
          
          // Show zero balance modal if balance is 0
          if (currentBalance === 0) {
            setShowZeroBalanceModal(true);
          }
          
          // Check if grace period was already granted today
          const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
          const lastGracePeriodDate = data.lastGracePeriodDate || null;
          const canGrantGracePeriod = lastGracePeriodDate !== today;
          
          console.log("✅ Dashboard loaded");
          console.log("ℹ️ Balance: ₱" + currentBalance.toFixed(2));
          console.log("🎁 Grace period eligibility:", canGrantGracePeriod ? "YES (not granted today)" : "NO (already granted today)");
          console.log("📅 Last grace period date:", lastGracePeriodDate || "Never");
          console.log("📅 Today's date:", today);
          
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
                
                // Set end time (5 minutes from now)
                const endTime = Date.now() + (300 * 1000);
                
                // Update Firestore with today's date AND sessionEndTime
                await Promise.race([
                  updateDoc(userDocRef, {
                    lastLogin: serverTimestamp(),
                    lastGracePeriodDate: today, // Record today's date
                    sessionEndTime: endTime, // Save session end timestamp
                    updatedAt: serverTimestamp(),
                  }),
                  timeoutPromise
                ]);
                
                setSessionEndTime(endTime);
                setHasActiveTime(true);
                setActiveTimeRemaining(300); // 5 minutes
                setIsSessionActive(true);
                
                // Save session to sessionStorage so user can return from portal
                sessionStorage.setItem('ezvendo_active_session', JSON.stringify({
                  rfid: rfidFromUrl,
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
        setHasActiveTime(false);
        setIsSessionActive(false);
        setSessionEndTime(null);
        setShowSessionExpiredModal(true);
        
        // Clear session from storage AND Firestore
        sessionStorage.removeItem('ezvendo_active_session');
        
        // Clear from Firestore
        const userDocRef = doc(db, "users", rfidFromUrl);
        updateDoc(userDocRef, {
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

  // Redirection Logic (Session Expired or Stop Confirmed)
  useEffect(() => {
    if (showSessionExpiredModal || showStopSuccess) {
      const redirectTimer = setTimeout(() => {
        router.push("/");
      }, 3000);
      return () => clearTimeout(redirectTimer);
    }
  }, [showSessionExpiredModal, showStopSuccess, router]);

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
    <div className="min-h-dvh flex justify-center text-sm sm:text-base sm:bg-white">
      <div className="flex flex-col gap-6 p-3 sm:p-4 md:px-0 w-full max-w-md">
        {/* header */}
        <div className="flex items-center justify-between">
          {/* left */}
          <div className="flex flex-col">
            {/* name */}
            <span className="text-gray-800 text-sm sm:text-base">
              Hello,{" "}
              <span className="text-green-500 font-semibold">
                {userData.firstName || userData.fullName?.split(" ")[0] || "User"}
              </span>
            </span>
            <span className="text-gray-500 text-xs">
              <span className="font-semibold">RFID:</span> {userData.rfidCardId}
            </span>
          </div>
          {/* right - Available Credits */}
          <div className="flex items-center gap-2">
            <div className="flex flex-col items-end">
              <span className="text-xs text-gray-500">Balance</span>
              <span className="text-green-600 font-bold text-base sm:text-lg">
                ₱{userBalance.toFixed(2)}
              </span>
            </div>
            <button
              onClick={handleTopUp}
              className="rounded-full border border-green-500 bg-green-500 hover:bg-green-600 active:bg-green-700 cursor-pointer transition-colors duration-150 p-2 text-white"
            >
              <Plus className="size-4 sm:size-5" />
            </button>
          </div>
        </div>
        {/* Back to Portal Button */}
        <div className="flex items-center justify-center">
          <button
            onClick={() => router.push("/")}
            className="text-sm text-gray-600 hover:text-green-600 underline"
          >
            ← Back to Portal
          </button>
        </div>

        {/* main */}
        <div className="flex flex-col gap-4">
          {/* Time remaining display */}
          {hasActiveTime && (
            <div className="flex items-center justify-center">
              <div className="col-span-1 flex flex-col items-center justify-center gap-1">
                <span className="text-gray-500 text-sm sm:text-base">Time Remaining</span>
                <span className="font-bold text-4xl sm:text-5xl text-green-500 tabular-nums">
                  {formatTime(activeTimeRemaining)}
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Internet active
                </span>
              </div>
            </div>
          )}
          
          {/* Time Package Buttons (Always visible - users can add more time anytime) */}
          <div className="flex flex-col gap-3 bg-white p-4 rounded-2xl border border-gray-300">
            <div className="text-center">
              <span className="font-semibold text-base">
                {hasActiveTime ? "Add More Time" : "Purchase Internet Time"}
              </span>
              <p className="text-xs text-gray-500 mt-1">
                Select a time package (₱{billingRatePerMinute.toFixed(2)}/min)
              </p>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              {/* 5 Minutes */}
              <button
                onClick={() => purchaseTimePackage(5)}
                disabled={userBalance < (5 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
              >
                <span className="text-2xl font-bold">5</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1">₱{(5 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 10 Minutes */}
              <button
                onClick={() => purchaseTimePackage(10)}
                disabled={userBalance < (10 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
              >
                <span className="text-2xl font-bold">10</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1">₱{(10 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 30 Minutes */}
              <button
                onClick={() => purchaseTimePackage(30)}
                disabled={userBalance < (30 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
              >
                <span className="text-2xl font-bold">30</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1">₱{(30 * billingRatePerMinute).toFixed(2)}</span>
              </button>
              
              {/* 60 Minutes */}
              <button
                onClick={() => purchaseTimePackage(60)}
                disabled={userBalance < (60 * billingRatePerMinute)}
                className="flex flex-col items-center justify-center p-4 rounded-xl bg-blue-500 hover:bg-blue-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white transition-colors"
              >
                <span className="text-2xl font-bold">60</span>
                <span className="text-xs">minutes</span>
                <span className="text-xs mt-1">₱{(60 * billingRatePerMinute).toFixed(2)}</span>
              </button>
            </div>
          </div>

          {/* Start / Stop Session / N/A */}
          {/* HIDDEN - Using time packages instead */}
          {/* <div className="flex items-center justify-center mb-2">
            <div className="relative flex items-center justify-center size-62">
              <div
                className={`absolute rounded-full size-60 ${
                  isLowBalance ? "bg-gray-100" : `${pulsingBaseColor}-200`
                } animate-concentric-pulse [animation-delay:-1s] transition-all ease-out`}
              ></div>
              <div
                className={`absolute rounded-full size-48 ${
                  isLowBalance ? "bg-gray-200" : `${pulsingBaseColor}-300`
                } animate-concentric-pulse [animation-delay:0s] transition-all ease-out`}
              ></div>

              <button
                onClick={handleStartStopSession}
                disabled={isLowBalance}
                className={`relative text-xl sm:text-2xl flex items-center justify-center rounded-full size-34 font-semibold shadow transition-colors duration-150 ${sessionButtonFinalClasses}`}
              >
                {isLowBalance ? "N/A" : sessionButtonText}
              </button>
            </div>
          </div> */}

          {/* information (Cards) */}
          <div className="grid grid-cols-1 gap-3">
            {/* Billing rate (From system config) */}
            <div className="col-span-1 flex items-center bg-blue-500 px-5 py-5 rounded-2xl">
              <div className="flex flex-col gap- flex-1">
                <span className="text-gray-50 text-sm">Billing rate</span>
                <span className="font-semibold text-white">
                  ₱{billingRatePerMinute.toFixed(2)} / min
                </span>
              </div>
            </div>
          </div>

          {/* Transactions */}
          <div className="flex flex-col gap-4 mt-2">
            {/* header */}
            <div className="flex items-center justify-between">
              <span className="text-lg font-semibold">Recent transactions</span>
              <Link
                href="/transactions"
                className=" text-gray-500  hover:text-green-500 active:text-green-600 transition-colors duration-150 flex items-center justify-center rounded-full gap-1"
              >
                <span className="text-sm">View all</span>
                <ChevronRight className="size-5" />
              </Link>
            </div>
            {/* 🛑 CONDITIONAL RENDERING FOR TRANSACTION LIST / EMPTY STATE */}
            {recentTransactions.length > 0 ? (
              // --- TRANSACTION CARDS ---
              <div className="flex flex-col gap-2">
                {recentTransactions.map((tx, index) => {
                  // FIX 1: Destructure new classes
                  const {
                    Icon,
                    SignIcon,
                    colorClass,
                    bgColorClass,
                  } = getTransactionDetails(tx.type);
                  const dateString = formatDate(tx.date);

                  return (
                    <div
                      key={index}
                      onClick={() => setSelectedTransaction(tx)}
                      className="flex items-center justify-between gap-4 p-5 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 active:bg-gray-100 transition-colors duration-150 cursor-pointer"
                    >
                      {/* left */}
                      <div className="flex items-center gap-3">
                        {/* 🛑 FIX 2: Apply bgColorClass to the background circle */}
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
                          <span className="text-sm text-gray-500">
                            {dateString}
                          </span>
                        </div>
                      </div>

                      {/* right - Dynamic Sign Icon and Amount */}
                      <div
                        // 🛑 FIX 3: Apply text color class directly
                        className={`flex items-center gap-1 ${colorClass}`}
                      >
                        <SignIcon className="size-4" />
                        <span className=" font-bold">
                          P{tx.amount.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // --- NO TRANSACTIONS EMPTY STATE ---
              // ... (JSX for No Transactions remains here) ...
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
            )}
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
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md max-h-[90vh] overflow-y-auto">
            {topUpSuccess ? (
              // Success State
              <>
                <div className="bg-green-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
                  <CheckCircle className="text-green-500 size-6 sm:size-7" />
                </div>
                <div className="flex flex-col text-center gap-2">
                  <span className="text-base sm:text-lg font-semibold text-green-600">
                    Request Submitted!
                  </span>
                  <span className="text-gray-500 text-xs sm:text-sm">
                    Your top-up request has been sent to the admin for approval
                  </span>
                </div>
              </>
            ) : (
              // Form State
              <>
                <div className="bg-blue-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
                  <BanknoteArrowUp className="text-blue-500 size-6 sm:size-7" />
                </div>

                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="flex flex-col text-center">
                    <span className="text-base sm:text-lg font-semibold">
                      Top-Up Request
                    </span>
                    <span className="text-gray-500 text-xs sm:text-sm">
                      Fill out the form below after sending payment
                    </span>
                  </div>
                </div>

                {/* Payment Info */}
                <div className="flex flex-col gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg w-full">
                  <span className="font-semibold text-sm text-blue-900">Send payment to:</span>
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-gray-800">
                      <span className="font-semibold">GCash:</span> 09266301717
                    </span>
                    <span className="text-xs text-gray-800">
                      <span className="font-semibold">Name:</span> Sonny S.
                    </span>
                  </div>
                  <span className="text-xs text-orange-600 font-semibold mt-1">
                    ⚠️ GCash payments only
                  </span>
                </div>

                {/* Form Fields */}
                <div className="flex flex-col gap-4 w-full">
                  {/* Amount */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                      Amount (₱) <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="number"
                      value={topUpAmount}
                      onChange={(e) => setTopUpAmount(e.target.value)}
                      placeholder="e.g. 100"
                      min="1"
                      step="0.01"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isSubmittingTopUp}
                    />
                  </div>

                  {/* Reference ID */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                      GCash Reference ID <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={topUpReferenceId}
                      onChange={(e) => setTopUpReferenceId(e.target.value)}
                      placeholder="e.g. 1234567890"
                      className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      disabled={isSubmittingTopUp}
                    />
                  </div>

                  {/* Receipt Upload */}
                  <div className="flex flex-col gap-2">
                    <label className="text-sm font-semibold text-gray-700">
                      Payment Receipt <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleReceiptUpload}
                      className="text-sm text-gray-600 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                      disabled={isSubmittingTopUp}
                    />
                    {topUpReceiptPreview && (
                      <div className="mt-2">
                        <img
                          src={topUpReceiptPreview}
                          alt="Receipt preview"
                          className="w-full h-32 object-cover rounded-lg border border-gray-200"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* Buttons */}
                <div className="flex items-center gap-2 w-full">
                  <button
                    onClick={handleCancelTopUp}
                    disabled={isSubmittingTopUp}
                    className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-gray-300 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitTopUp}
                    disabled={isSubmittingTopUp}
                    className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
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

                <div className="flex items-center justify-center py-2">
                  <span className="text-gray-500 text-xs sm:text-sm animate-pulse">
                    Redirecting to portal...
                  </span>
                </div>
              </div>
            </div>
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
    </div>
  );
}
