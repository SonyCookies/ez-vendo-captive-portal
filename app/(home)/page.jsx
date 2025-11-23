"use client";

import {
  Info,
  CircleQuestionMark,
  Headset,
  WifiOff,
  Wifi,
  Search,
  CheckCircle,
  UserPlus,
  X,
  BanknoteX,
  BanknoteArrowUp,
  Clock,
  ChevronDown,
  UserX,
  CreditCard,
  Radio,
} from "lucide-react";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useESP8266Polling } from "@/app/hooks/useESP8266Polling";
import { db } from "@/app/config/firebase";
import { doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";

// Modal states
const MODAL_STATE = {
  HIDDEN: "HIDDEN",
  CHECKING: "CHECKING",
  GRANTING_ACCESS: "GRANTING_ACCESS",
  REGISTERED: "REGISTERED",
  UNREGISTERED: "UNREGISTERED",
  ATTEMPTS_EXCEEDED: "ATTEMPTS_EXCEEDED",
  GRACE_PERIOD_USED: "GRACE_PERIOD_USED",
  BLACKLISTED: "BLACKLISTED",
  ERROR: "ERROR",
};

export default function Home() {
  const router = useRouter();
  const MAX_ATTEMPTS = 3;
  const [isOnline, setIsOnline] = useState(true);
  const [scannedCardId, setScannedCardId] = useState(null);
  const [modalState, setModalState] = useState(MODAL_STATE.HIDDEN);
  const [userData, setUserData] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [currentAttempts, setCurrentAttempts] = useState(0);
  
  // Scanning state control
  const [isScanning, setIsScanning] = useState(false);
  const [scanTimeout, setScanTimeout] = useState(30);
  
  // Active session detection
  const [activeSession, setActiveSession] = useState(null);
  
  // How it Works modal state
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);
  const [isHowItWorksClosing, setIsHowItWorksClosing] = useState(false);
  const [isHowItWorksOpening, setIsHowItWorksOpening] = useState(false);

  // Handle RFID card detection from ESP32
  const handleCardDetected = useCallback(
    async (cardData) => {
      console.log("📡 RFID Result from ESP32:", cardData);
      
      setIsScanning(false);
      
      const { cardId, isRegistered } = cardData.rawData || cardData;
      
      setScannedCardId(cardId);

      setModalState(MODAL_STATE.CHECKING);
      
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Extract blacklist status FIRST - this is the strongest guard
      const { 
        isBlacklisted = false,
        cardStatus = ""
      } = cardData.rawData || cardData;

      // BLACKLIST CHECK - STRONGEST GUARD (blocks regardless of balance, grace period, or active status)
      if (isBlacklisted || cardStatus === "blacklisted") {
        console.log("🚫 User is BLACKLISTED - Access DENIED!");
        setModalState(MODAL_STATE.BLACKLISTED);
        return; // Block immediately, don't proceed with any other checks
      }

      if (isRegistered) {
        console.log("✅ ESP32 verified: User is REGISTERED");
        
        const { 
          balance = 0, 
          lastGracePeriodDate = "",
          savedRemainingTimeSeconds = 0,
          savedTimeDate = ""
        } = cardData.rawData || cardData;
        
        const today = new Date().toISOString().split('T')[0];
        const gracePeriodUsedToday = (lastGracePeriodDate === today);
        const hasSavedTime = savedRemainingTimeSeconds > 0;
        const isNewDay = savedTimeDate !== today && savedTimeDate !== "";
        
        console.log("💰 User balance (from ESP32):", balance);
        console.log("📅 Last grace period date (from ESP32):", lastGracePeriodDate || "Never");
        console.log("📅 Today's date (from device):", today);
        console.log("🎁 Grace period used today:", gracePeriodUsedToday);
        console.log("💾 Saved time (from ESP32):", savedRemainingTimeSeconds, "seconds");
        console.log("📅 Saved time date (from ESP32):", savedTimeDate || "Never");
        console.log("🔄 Has saved time:", hasSavedTime);
        console.log("🔄 Is new day (for saved time):", isNewDay);
        
        setModalState(MODAL_STATE.REGISTERED);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        if (balance === 0 && gracePeriodUsedToday && !hasSavedTime) {
          console.log("⚠️ Zero balance + grace period already used today + no saved time!");
          setModalState(MODAL_STATE.GRACE_PERIOD_USED);
          return;
        }
        
        if (hasSavedTime) {
          console.log("✅ User has saved time - Access will be granted");
          console.log(`   Saved time: ${Math.floor(savedRemainingTimeSeconds / 60)} minutes`);
          if (isNewDay) {
            console.log("   Will be added to today's grace period");
          } else {
            console.log("   Will be restored directly (same day)");
          }
        }
        
        setModalState(MODAL_STATE.GRANTING_ACCESS);
        console.log("🌐 Granting internet access for registered user...");
        
        try {
          // Get user data from Firestore to check for active session, saved time, etc.
          const userDocRef = doc(db, "users", cardId);
          const userSnap = await getDoc(userDocRef);
          
          let durationSeconds = 300; // Default: 5-minute grace period
          
          if (userSnap.exists()) {
            const userData = userSnap.data();
            const now = Date.now();
            
            // Check if there's an active session
            if (userData.sessionEndTime && userData.sessionEndTime > now) {
              // Active session exists - use remaining time
              durationSeconds = Math.floor((userData.sessionEndTime - now) / 1000);
              console.log(`🔄 Active session found - using remaining time: ${Math.floor(durationSeconds / 60)} minutes`);
            } else {
              // No active session - check for saved time and grace period
              const savedTime = userData.savedRemainingTimeSeconds || 0;
              const savedTimeDate = userData.savedTimeDate || null;
              const lastGracePeriodDate = userData.lastGracePeriodDate || null;
              const isNewDay = savedTimeDate !== today && savedTimeDate !== "";
              const canGrantGrace = lastGracePeriodDate !== today;
              
              if (savedTime > 0) {
                durationSeconds = savedTime;
                if (isNewDay && canGrantGrace) {
                  durationSeconds += 300; // Add grace period
                  console.log(`💾 Including saved time (${Math.floor(savedTime / 60)} min) + grace period (5 min) = ${Math.floor(durationSeconds / 60)} min`);
                } else {
                  console.log(`💾 Including saved time: ${Math.floor(savedTime / 60)} minutes`);
                }
              } else if (canGrantGrace) {
                // No saved time, but grace period available
                durationSeconds = 300; // 5 minutes grace
                console.log(`🎁 Granting grace period: 5 minutes`);
              } else {
                // No saved time, no grace period
                durationSeconds = 0;
                console.log(`⚠️ No time available (no saved time, grace period used)`);
              }
            }
          }
          
          if (durationSeconds <= 0) {
            console.log("⚠️ No time available to grant");
            setModalState(MODAL_STATE.GRACE_PERIOD_USED);
            return;
          }
          
          const orangePiUrl = `http://192.168.1.1:8080/grant-time?duration=${durationSeconds}`;
          console.log("📡 Calling Orange Pi API:", orangePiUrl);
          
          const grantResponse = await fetch(orangePiUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });
          
          if (grantResponse.ok) {
            const data = await grantResponse.json();
            console.log("✅ Orange Pi confirmed: Internet access granted!", data);
            
            try {
              await fetch(`${process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10"}/notify-success`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
              });
              console.log("🔔 ESP32 notified - Success feedback triggered");
            } catch (err) {
              console.log("⚠️ Could not notify ESP32 for feedback (non-critical)");
            }
            
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            console.log("✅ Access confirmed - Redirecting to dashboard");
            setModalState(MODAL_STATE.HIDDEN);
            router.push(`/dashboard?rfid=${encodeURIComponent(cardId)}`);
          } else {
            console.error("❌ Orange Pi API returned error:", grantResponse.status);
            setModalState(MODAL_STATE.ERROR);
            setErrorMessage("Failed to grant internet access. Please try scanning again.");
            return;
          }
        } catch (error) {
          console.error("❌ Failed to call Orange Pi API:", error);
          setModalState(MODAL_STATE.ERROR);
          setErrorMessage("Failed to grant internet access. Please try scanning again.");
          return;
        }
        
      } else {
        console.log("⚠️ ESP32 verified: NOT REGISTERED");
        
        const { attempts = 0, attemptsExceeded = false } = cardData.rawData || cardData;
        
        console.log(`📊 Current attempts: ${attempts}/${MAX_ATTEMPTS}`);
        setCurrentAttempts(attempts);
        
        if (attemptsExceeded || attempts >= MAX_ATTEMPTS) {
          console.log("🔒 Max attempts reached - BLOCKED!");
          setModalState(MODAL_STATE.ATTEMPTS_EXCEEDED);
          return;
        }
        
        try {
          const userDocRef = doc(db, "users", cardId);
          const userSnap = await getDoc(userDocRef);
          
          const newAttempts = attempts + 1;
          
          if (userSnap.exists()) {
            await updateDoc(userDocRef, {
              attempts: newAttempts,
              lastAttempt: serverTimestamp(),
            });
          } else {
            await setDoc(userDocRef, {
              rfidCardId: cardId,
              isRegistered: false,
              attempts: newAttempts,
              firstScan: serverTimestamp(),
              lastAttempt: serverTimestamp(),
            });
          }
          
          console.log(`📊 Updated Firestore: ${newAttempts}/${MAX_ATTEMPTS} attempts`);
          
        } catch (error) {
          console.error("❌ Error updating attempts:", error);
        }
        
        setModalState(MODAL_STATE.UNREGISTERED);
        
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        setModalState(MODAL_STATE.GRANTING_ACCESS);
        console.log("🌐 Granting 5-minute trial access...");
        
        const esp32Url = process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10";
        let accessGranted = false;
        let pollAttempts = 0;
        const maxPollAttempts = 10;
        
        while (!accessGranted && pollAttempts < maxPollAttempts) {
          try {
            const response = await fetch(`${esp32Url}/access-granted`, {
              method: 'GET',
              signal: AbortSignal.timeout(2000)
            });
            
            if (response.ok) {
              const data = await response.json();
              if (data.accessGranted) {
                console.log("✅ ESP32 confirmed: Trial access granted!");
                accessGranted = true;
                break;
              }
            }
          } catch (error) {
            console.log(`⏳ Waiting for trial access confirmation... (${pollAttempts + 1}/${maxPollAttempts})`);
          }
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          pollAttempts++;
        }
        
        if (!accessGranted) {
          console.error("❌ Could not confirm trial access!");
          setModalState(MODAL_STATE.ERROR);
          setErrorMessage("Failed to grant trial access. Please try scanning again.");
          return;
        }
        
        console.log("✅ Trial access confirmed - Redirecting to registration");
        setModalState(MODAL_STATE.HIDDEN);
        router.push(`/register?rfid=${encodeURIComponent(cardId)}&attempt=${currentAttempts}`);
      }
    },
    [router]
  );

  // Check for active session on mount
  useEffect(() => {
    const checkActiveSession = () => {
      try {
        const sessionData = sessionStorage.getItem('ezvendo_active_session');
        if (sessionData) {
          const session = JSON.parse(sessionData);
          if (session.sessionEndTime && session.sessionEndTime > Date.now()) {
            const timeRemaining = Math.floor((session.sessionEndTime - Date.now()) / 1000);
            setActiveSession({
              rfid: session.rfid,
              timeRemaining: timeRemaining,
              sessionEndTime: session.sessionEndTime
            });
            console.log("✅ Active session detected:", session.rfid, "Time remaining:", timeRemaining, "seconds");
          } else {
            sessionStorage.removeItem('ezvendo_active_session');
            console.log("⏰ Session expired, cleared from storage");
          }
        }
      } catch (error) {
        console.error("Error checking active session:", error);
      }
    };

    checkActiveSession();
    
    const interval = setInterval(checkActiveSession, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Check ESP32 connection status
  const [isConnected, setIsConnected] = useState(false);
  
  useEffect(() => {
    const checkConnection = async () => {
      try {
        const response = await fetch(
          `${process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10"}/status`,
          { method: 'GET', signal: AbortSignal.timeout(2000) }
        );
        if (response.ok) {
          setIsConnected(true);
        }
      } catch (err) {
        setIsConnected(false);
      }
    };
    
    checkConnection();
    
    const interval = setInterval(checkConnection, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Poll ESP32 for RFID scans ONLY when scanning is active
  const { rfidData, loading: rfidLoading, error: rfidError } = useESP8266Polling(
    process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10",
    handleCardDetected,
    isScanning,
    1000
  );
  
  // Countdown timer for scan timeout
  useEffect(() => {
    if (!isScanning) {
      setScanTimeout(30);
      return;
    }
    
    const timer = setInterval(() => {
      setScanTimeout((prev) => {
        if (prev <= 1) {
          setIsScanning(false);
          console.log("⏱️ Scan timeout - stopped");
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [isScanning]);
  
  const handleStartScan = () => {
    console.log("🔍 Starting RFID scan...");
    setIsScanning(true);
    setScanTimeout(30);
  };
  
  const handleStopScan = () => {
    console.log("🛑 Scan stopped by user");
    setIsScanning(false);
  };

  // Online/Offline detection
  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }

    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Modal states for animations
  const [isClosing, setIsClosing] = useState(false);
  const [isOpening, setIsOpening] = useState(false);

  // Trigger opening animation when modal state changes
  useEffect(() => {
    if (modalState !== MODAL_STATE.HIDDEN) {
      setIsClosing(false);
      setIsOpening(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setIsOpening(true);
        });
      });
    }
  }, [modalState]);

  const closeModal = () => {
    if (isClosing) return;
    setIsOpening(false);
    setIsClosing(true);
    setTimeout(() => {
      setModalState(MODAL_STATE.HIDDEN);
      setIsClosing(false);
    }, 300);
  };

  // How it Works modal handlers
  const openHowItWorksModal = () => {
    setIsHowItWorksClosing(false);
    setIsHowItWorksOpening(false);
    setShowHowItWorksModal(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setIsHowItWorksOpening(true);
      });
    });
  };

  const closeHowItWorksModal = () => {
    if (isHowItWorksClosing) return;
    setIsHowItWorksOpening(false);
    setIsHowItWorksClosing(true);
    setTimeout(() => {
      setShowHowItWorksModal(false);
      setIsHowItWorksClosing(false);
    }, 300);
  };

  const anyModalOpen = modalState !== MODAL_STATE.HIDDEN || !isOnline;
  useEffect(() => {
    document.body.style.overflow = anyModalOpen ? "hidden" : "auto";
    return () => (document.body.style.overflow = "auto");
  }, [anyModalOpen]);

  return (
    <div className="min-h-dvh flex flex-col text-sm sm:text-base relative max-w-md mx-auto w-full">
      <div className="flex flex-1 flex-col px-3 py-4 sm:p-4 gap-4">
        {/* Welcome Card - Matching Admin Design */}
        <div className="flex relative rounded-2xl bg-linear-to-r from-green-500 via-green-400 to-green-500 p-5 text-white">
          <div className="flex flex-1 flex-col gap-2">
            <span className="text-2xl sm:text-3xl font-bold">
              Welcome to EZ-Vendo
            </span>
            <div className="flex flex-col">
              <span className="text-sm sm:text-base font-semibold text-white">
                Secure and convenient vending experience
              </span>
            </div>
          </div>
          <div className="absolute top-3 right-3 rounded-full p-3 bg-green-600/40 shadow-green-600/40">
            <Wifi className="size-6 sm:size-7" />
          </div>
        </div>

        {/* Active Session Card */}
        {activeSession && (
          <div className="flex relative rounded-2xl bg-linear-to-r from-green-500 via-green-400 to-green-500 p-5 text-white">
            <div className="flex flex-1 flex-col gap-2">
              <span className="text-xl sm:text-2xl font-bold">
                Active Session Found
              </span>
              <div className="flex flex-col gap-1">
                <span className="text-sm sm:text-base font-semibold text-white">
                  Time Remaining
                </span>
                <span className="text-3xl sm:text-4xl font-bold tabular-nums">
                  {Math.floor(activeSession.timeRemaining / 60)}:{String(activeSession.timeRemaining % 60).padStart(2, '0')}
                </span>
                <span className="text-xs text-gray-100">
                  RFID: {activeSession.rfid}
                </span>
              </div>
            </div>
            <div className="absolute top-3 right-3 rounded-full p-3 bg-green-600/40 shadow-green-600/40">
              <Clock className="size-6 sm:size-7" />
            </div>
            <button
              onClick={() => router.push(`/dashboard?rfid=${encodeURIComponent(activeSession.rfid)}`)}
              className="absolute bottom-5 right-5 px-4 py-2 bg-white/20 hover:bg-white/30 active:bg-white/40 rounded-lg text-white text-sm font-semibold transition-colors duration-150"
            >
              Return to Dashboard
            </button>
          </div>
        )}

        {/* Main Scanning Card - RFID Scanner UI */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-xs sm:text-sm font-semibold text-gray-500 mt-2">
              RFID Scanner
            </span>
            
            <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-300 flex flex-col gap-4 items-center">
              {/* Scanner Status Header */}
              <div className="flex flex-col gap-1 text-center pt-2 w-full">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <div className={`p-2 rounded-full ${!isConnected ? 'bg-gray-200' : isScanning ? 'bg-green-100' : 'bg-blue-100'}`}>
                    <Radio className={`size-5 ${!isConnected ? 'text-gray-500' : isScanning ? 'text-green-500' : 'text-blue-500'}`} />
                  </div>
                  <span className={`text-xl sm:text-2xl font-bold ${!isConnected ? 'text-gray-500' : isScanning ? 'text-green-500' : 'text-gray-800'}`}>
                    {!isConnected ? (
                      "Scanner Offline"
                    ) : isScanning ? (
                      "Scanning..."
                    ) : (
                      "Ready to Scan"
                    )}
                  </span>
                </div>
                <span className="text-gray-500 text-xs sm:text-sm">
                  {!isConnected
                    ? "Waiting for RFID scanner connection..."
                    : isScanning
                    ? "Place your card on the scanner"
                    : "Click 'Start Scan' to begin"}
                </span>
              </div>
              
              {/* RFID Scanner Device UI */}
              <div className="w-full flex flex-col items-center justify-center gap-4 my-3">
                {/* Scanner Device Container */}
                <div className="relative w-full max-w-xs">
                  {/* Scanner Device Body */}
                  <div className={`relative rounded-2xl p-6 sm:p-8 border-2 transition-all duration-300 ${
                    !isConnected 
                      ? 'bg-gray-100 border-gray-300' 
                      : isScanning 
                      ? 'bg-gradient-to-br from-green-50 to-green-100 border-green-400 shadow-lg shadow-green-200' 
                      : 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-300'
                  }`}>
                    {/* Scanning Waves Animation */}
                    {isScanning && (
                      <div className="absolute inset-0 overflow-hidden rounded-2xl">
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full">
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-300/30 animate-ping" style={{ width: '200%', height: '200%', animationDuration: '2s' }}></div>
                          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-green-400/20 animate-ping" style={{ width: '150%', height: '150%', animationDuration: '2s', animationDelay: '0.5s' }}></div>
                        </div>
                      </div>
                    )}

                    {/* Card Slot Area */}
                    <div className="relative z-10 flex flex-col items-center gap-4">
                      {/* Card Slot Visual */}
                      <div className={`relative w-48 h-32 sm:w-56 sm:h-36 rounded-xl border-2 border-dashed transition-all duration-300 ${
                        !isConnected 
                          ? 'border-gray-300 bg-gray-50' 
                          : isScanning 
                          ? 'border-green-400 bg-green-50/50 shadow-inner' 
                          : 'border-blue-300 bg-blue-50/50'
                      }`}>
                        {/* Card Placeholder */}
                        <div className={`absolute inset-2 rounded-lg transition-all duration-300 ${
                          !isConnected 
                            ? 'bg-gray-200' 
                            : isScanning 
                            ? 'bg-gradient-to-br from-green-400 to-green-500 shadow-lg animate-pulse' 
                            : 'bg-gradient-to-br from-blue-300 to-blue-400'
                        }`}>
                          <div className="absolute inset-0 flex items-center justify-center">
                            <CreditCard className={`size-8 sm:size-10 ${
                              !isConnected ? 'text-gray-400' : isScanning ? 'text-white' : 'text-blue-600'
                            }`} />
                          </div>
                        </div>
                        
                        {/* Scanning Indicator Lines */}
                        {isScanning && (
                          <div className="absolute inset-0 overflow-hidden rounded-lg">
                            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent animate-scan-line"></div>
                            <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-green-400 to-transparent animate-scan-line" style={{ animationDelay: '0.5s' }}></div>
                          </div>
                        )}
                      </div>

                      {/* Status Indicator */}
                      <div className="flex items-center gap-2">
                        <div className={`size-2 rounded-full transition-all duration-300 ${
                          !isConnected 
                            ? 'bg-gray-400' 
                            : isScanning 
                            ? 'bg-green-500 animate-pulse' 
                            : 'bg-blue-500'
                        }`}></div>
                        <span className={`text-xs sm:text-sm font-semibold ${
                          !isConnected ? 'text-gray-500' : isScanning ? 'text-green-600' : 'text-blue-600'
                        }`}>
                          {!isConnected ? 'Offline' : isScanning ? 'Detecting...' : 'Standby'}
                        </span>
                      </div>

                      {/* Timeout Counter (when scanning) */}
                      {isScanning && (
                        <div className="flex items-center gap-2 px-4 py-2 bg-white rounded-full border border-green-300 shadow-sm">
                          <Clock className="size-4 text-green-600" />
                          <span className="text-sm font-bold text-green-600 tabular-nums">
                            {scanTimeout}s
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                
                {/* Control Buttons */}
                <div className="flex flex-col items-center gap-3 w-full">
                  {!isScanning ? (
                    <button
                      onClick={handleStartScan}
                      disabled={!isConnected}
                      className="w-full max-w-xs px-6 py-3 rounded-full bg-green-500 hover:bg-green-600 disabled:bg-gray-400 disabled:cursor-not-allowed text-white text-base font-semibold shadow-lg transition-all duration-150 flex items-center justify-center gap-2"
                    >
                      <Radio className="size-5" />
                      Start Scan
                    </button>
                  ) : (
                    <button
                      onClick={handleStopScan}
                      className="w-full max-w-xs px-6 py-3 rounded-full bg-red-500 hover:bg-red-600 text-white text-base font-semibold shadow-lg transition-all duration-150 flex items-center justify-center gap-2"
                    >
                      <X className="size-5" />
                      Stop Scanning
                    </button>
                  )}
                </div>
              </div>

              {/* How it Works Button */}
              <button
                onClick={openHowItWorksModal}
                className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border border-gray-300 bg-gray-50 hover:bg-gray-100 active:bg-gray-200 transition-colors duration-150"
              >
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full p-1.5">
                  <Info className="text-white size-4" />
                </div>
                <span className="text-gray-700 text-xs sm:text-sm font-semibold">
                  How it works
                </span>
                <ChevronDown className="size-4 text-gray-500 ml-auto" />
              </button>
            </div>
          </div>

          {/* Contact Support */}
          <div className="flex flex-col items-center justify-center gap-1 mb-2">
            <span className="text-gray-500 text-xs sm:text-sm">
              Having trouble?
            </span>
            <button className="flex items-center gap-1 text-green-500 font-semibold text-xs sm:text-sm hover:text-green-600 transition-colors duration-150">
              <Headset className="text-green-500 size-4" />
              Contact Support
            </button>
          </div>
        </div>
      </div>

      {/* RFID Detection Modal - Redesigned */}
      {modalState !== MODAL_STATE.HIDDEN && (
        <div 
          className={`fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-50 overflow-y-auto transition-opacity duration-300 ${
            isClosing ? "opacity-0" : "opacity-100"
          }`}
          onClick={closeModal}
        >
          <div 
            className={`rounded-2xl relative bg-white w-full max-w-5xl flex flex-col gap-3 mt-2 mb-2 transition-all duration-300 ease-in-out ${
              isClosing 
                ? "translate-y-[150vh] opacity-0 scale-95" 
                : isOpening
                ? "translate-y-0 opacity-100 scale-100"
                : "translate-y-[20px] opacity-0 scale-[0.95]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* CLOSE BUTTON - Top Middle */}
            {(modalState === MODAL_STATE.ATTEMPTS_EXCEEDED || modalState === MODAL_STATE.GRACE_PERIOD_USED || modalState === MODAL_STATE.BLACKLISTED || modalState === MODAL_STATE.ERROR) && (
              <button
                onClick={closeModal}
                className="absolute top-[-16px] left-1/2 transform -translate-x-1/2 z-10 p-2 cursor-pointer rounded-full bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-150 text-gray-600 shadow-lg"
              >
                <ChevronDown className="size-5 sm:size-6" />
              </button>
            )}

            {/* HEADER CARD - Dynamic based on state */}
            <div className={`flex relative rounded-t-2xl p-4 sm:p-5 text-white ${
              modalState === MODAL_STATE.CHECKING || modalState === MODAL_STATE.GRANTING_ACCESS
                ? "bg-linear-to-r from-blue-500 via-blue-400 to-blue-500"
                : modalState === MODAL_STATE.REGISTERED
                ? "bg-linear-to-r from-green-500 via-green-400 to-green-500"
                : modalState === MODAL_STATE.UNREGISTERED
                ? "bg-linear-to-r from-yellow-500 via-yellow-400 to-yellow-500"
                : modalState === MODAL_STATE.ATTEMPTS_EXCEEDED || modalState === MODAL_STATE.BLACKLISTED || modalState === MODAL_STATE.ERROR
                ? "bg-linear-to-r from-red-500 via-red-400 to-red-500"
                : "bg-linear-to-r from-orange-500 via-orange-400 to-orange-500"
            }`}>
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  {modalState === MODAL_STATE.CHECKING && "Checking Card..."}
                  {modalState === MODAL_STATE.GRANTING_ACCESS && "Granting Internet Access..."}
                  {modalState === MODAL_STATE.REGISTERED && "Card Registered!"}
                  {modalState === MODAL_STATE.UNREGISTERED && "Card Not Registered"}
                  {modalState === MODAL_STATE.ATTEMPTS_EXCEEDED && "Maximum Attempts Reached"}
                  {modalState === MODAL_STATE.GRACE_PERIOD_USED && "Grace Period Already Used"}
                  {modalState === MODAL_STATE.BLACKLISTED && "Access Denied"}
                  {modalState === MODAL_STATE.ERROR && "Error"}
                </span>
                <div className="flex flex-col gap-0.5">
                  {scannedCardId && (
                    <span className="text-xs sm:text-sm font-semibold text-white">
                      Card ID: {scannedCardId}
                    </span>
                  )}
                  {modalState === MODAL_STATE.UNREGISTERED && (
                    <span className="text-xs text-gray-100">
                      Attempt: {currentAttempts}/{MAX_ATTEMPTS}
                    </span>
                  )}
                </div>
              </div>
              <div className={`absolute top-3 right-3 rounded-full p-2.5 sm:p-3 shadow-600/40 ${
                modalState === MODAL_STATE.CHECKING || modalState === MODAL_STATE.GRANTING_ACCESS
                  ? "bg-blue-600/40 shadow-blue-600/40"
                  : modalState === MODAL_STATE.REGISTERED
                  ? "bg-green-600/40 shadow-green-600/40"
                  : modalState === MODAL_STATE.UNREGISTERED
                  ? "bg-yellow-600/40 shadow-yellow-600/40"
                  : modalState === MODAL_STATE.ATTEMPTS_EXCEEDED || modalState === MODAL_STATE.BLACKLISTED || modalState === MODAL_STATE.ERROR
                  ? "bg-red-600/40 shadow-red-600/40"
                  : "bg-orange-600/40 shadow-orange-600/40"
              }`}>
                {modalState === MODAL_STATE.CHECKING && <Search className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.GRANTING_ACCESS && <Wifi className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.REGISTERED && <CheckCircle className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.UNREGISTERED && <UserPlus className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.ATTEMPTS_EXCEEDED && <X className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.GRACE_PERIOD_USED && <BanknoteX className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.BLACKLISTED && <UserX className="size-5 sm:size-6" />}
                {modalState === MODAL_STATE.ERROR && <X className="size-5 sm:size-6" />}
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              {/* Pulsing animation for checking and granting access */}
              {(modalState === MODAL_STATE.CHECKING || modalState === MODAL_STATE.GRANTING_ACCESS) && (
                <div className="flex items-center justify-center py-4">
                  <div className="relative flex items-center justify-center">
                    <div className="absolute rounded-full size-22 bg-green-200 animate-concentric-pulse [animation-delay:-1s]"></div>
                    <div className="absolute rounded-full size-16 bg-green-300 animate-concentric-pulse [animation-delay:0s]"></div>
                    <div className={`relative size-12 sm:size-14 flex items-center justify-center rounded-full z-50 ${
                      modalState === MODAL_STATE.CHECKING ? "bg-green-400" : "bg-blue-500"
                    }`}>
                      {modalState === MODAL_STATE.CHECKING ? (
                        <Search className="text-white size-7 sm:size-8 animate-pulse" />
                      ) : (
                        <Wifi className="text-white size-7 sm:size-8 animate-pulse" />
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Message Content */}
              <div className="text-center flex flex-col gap-2">
                {modalState === MODAL_STATE.CHECKING && (
                  <span className="text-gray-500 text-sm">
                    Please wait while we verify your card...
                  </span>
                )}

                {modalState === MODAL_STATE.GRANTING_ACCESS && (
                  <>
                    <span className="text-gray-500 text-sm">
                      Please wait
                    </span>
                    <span className="text-gray-500 text-xs animate-pulse">
                      Configuring network access...
                    </span>
                  </>
                )}

                {modalState === MODAL_STATE.REGISTERED && (
                  <span className="text-gray-500 text-xs">
                    Preparing dashboard...
                  </span>
                )}

                {modalState === MODAL_STATE.UNREGISTERED && (
                  <span className="text-gray-500 text-xs">
                    Preparing registration...
                  </span>
                )}

                {modalState === MODAL_STATE.ATTEMPTS_EXCEEDED && (
                  <>
                    <span className="text-gray-500 text-sm">
                      You have used all {MAX_ATTEMPTS} attempts
                    </span>
                    <span className="text-gray-500 text-xs">
                      Please contact administrator for assistance
                    </span>
                  </>
                )}

                {modalState === MODAL_STATE.GRACE_PERIOD_USED && (
                  <>
                    <span className="text-gray-500 text-sm">
                      Your balance is zero and you've already used your free 5-minute grace period today.
                    </span>
                    
                    {/* Information Cards */}
                    <div className="flex flex-col gap-3 mt-3 w-full">
                      {/* Top-up via App */}
                      <div className="flex items-start gap-2 p-3 rounded-lg border border-blue-200 bg-blue-50">
                        <div className="flex items-center justify-center min-w-6 min-h-6 bg-blue-500 rounded-full mt-0.5">
                          <BanknoteArrowUp className="text-white size-4" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-sm">Top-up via App</span>
                          <span className="text-gray-600 text-xs">
                            Log in to the app using another device and follow the top-up instructions to add balance to your account.
                          </span>
                        </div>
                      </div>
                      
                      {/* Contact Admin */}
                      <div className="flex items-start gap-2 p-3 rounded-lg border border-green-200 bg-green-50">
                        <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full mt-0.5">
                          <Headset className="text-white size-4" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-sm">Contact Admin</span>
                          <span className="text-gray-600 text-xs">
                            Visit the administrator directly for instant top-up and assistance.
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <span className="text-gray-400 text-xs mt-2">
                      Note: Grace period renews daily at midnight
                    </span>
                  </>
                )}

                {modalState === MODAL_STATE.BLACKLISTED && (
                  <>
                    <span className="text-gray-500 text-sm">
                      Your account has been blacklisted by the administrator.
                    </span>
                    <span className="text-gray-500 text-xs">
                      Access is denied regardless of balance, grace period, or active status.
                    </span>
                    
                    {/* Information Card */}
                    <div className="flex flex-col gap-3 mt-3 w-full">
                      <div className="flex items-start gap-2 p-3 rounded-lg border border-red-200 bg-red-50">
                        <div className="flex items-center justify-center min-w-6 min-h-6 bg-red-500 rounded-full mt-0.5">
                          <Headset className="text-white size-4" />
                        </div>
                        <div className="flex flex-col gap-1">
                          <span className="font-semibold text-sm">Contact Administrator</span>
                          <span className="text-gray-600 text-xs">
                            Please contact the administrator directly to resolve this issue and restore access to your account.
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {modalState === MODAL_STATE.ERROR && (
                  <span className="text-gray-500 text-sm">
                    {errorMessage || "Failed to check card"}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* How it Works Modal */}
      {showHowItWorksModal && (
        <div 
          className={`flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50 overflow-y-auto transition-opacity duration-300 ${
            isHowItWorksClosing ? "opacity-0" : "opacity-100"
          }`}
          onClick={closeHowItWorksModal}
        >
          <div 
            className={`rounded-2xl relative bg-white w-full max-w-md flex flex-col gap-3 mt-2 mb-2 transition-all duration-300 ease-in-out ${
              isHowItWorksClosing 
                ? "translate-y-[150vh] opacity-0 scale-95" 
                : isHowItWorksOpening
                ? "translate-y-0 opacity-100 scale-100"
                : "translate-y-[20px] opacity-0 scale-[0.95]"
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close Button */}
            <button
              onClick={closeHowItWorksModal}
              className="absolute top-[-16px] left-1/2 transform -translate-x-1/2 z-10 p-2 cursor-pointer rounded-full bg-white border-2 border-gray-300 hover:bg-gray-50 hover:border-gray-400 active:bg-gray-100 transition-all duration-150 text-gray-600 shadow-lg"
            >
              <ChevronDown className="size-5 sm:size-6" />
            </button>

            {/* Header Card */}
            <div className="flex relative rounded-t-2xl p-4 sm:p-5 text-white bg-linear-to-r from-green-500 via-green-400 to-green-500">
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  How it Works
                </span>
                <span className="text-xs sm:text-sm font-semibold text-white">
                  Learn how to use EZ-Vendo
                </span>
              </div>
              <div className="absolute top-3 right-3 rounded-full p-2.5 sm:p-3 bg-green-600/40 shadow-green-600/40">
                <CircleQuestionMark className="size-5 sm:size-6" />
              </div>
            </div>

            {/* Main Content */}
            <div className="flex flex-col gap-4 p-4 sm:p-5">
              {/* How it Works Info */}
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3 p-3 rounded-lg border border-gray-300 bg-gray-50">
                  <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full p-1.5 mt-0.5">
                    <Info className="text-white size-4" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <span className="text-gray-700 text-xs sm:text-sm font-semibold">
                      Quick Overview:
                    </span>
                    <ul className="text-gray-600 text-xs list-disc list-inside space-y-1">
                      <li><span className="font-semibold">New user?</span> Tap your card to get 5 minutes free to register (3 attempts max)</li>
                      <li><span className="font-semibold">Registered?</span> Tap your card to access dashboard and start browsing</li>
                      <li><span className="font-semibold">Billing:</span> Pay per minute based on your balance</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Step-by-Step Instructions */}
              <div className="flex flex-col gap-2">
                <span className="text-base sm:text-lg font-semibold text-gray-800">
                  Step-by-Step Instructions
                </span>
                <div className="flex flex-col gap-3 sm:gap-4">
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
                    <div className="flex items-center justify-center text-center bg-green-500 size-8 rounded-full flex-shrink-0">
                      <span className="text-white text-sm font-semibold">1</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-800">
                        Click "Start Scan" button
                      </span>
                      <span className="text-xs text-gray-600">
                        This activates the RFID scanner and prepares it to read your card.
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
                    <div className="flex items-center justify-center text-center bg-green-500 size-8 rounded-full flex-shrink-0">
                      <span className="text-white text-sm font-semibold">2</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-800">
                        Place your RFID Card on the scanner
                      </span>
                      <span className="text-xs text-gray-600">
                        Hold your card steady on the scanner area. The scanner will detect it automatically.
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
                    <div className="flex items-center justify-center text-center bg-green-500 size-8 rounded-full flex-shrink-0">
                      <span className="text-white text-sm font-semibold">3</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-800">
                        Wait for card recognition
                      </span>
                      <span className="text-xs text-gray-600">
                        The system will verify your card and check your account status. This usually takes a few seconds.
                      </span>
                    </div>
                  </div>
                  
                  <div className="flex items-start gap-3 p-3 rounded-lg border border-green-200 bg-green-50">
                    <div className="flex items-center justify-center text-center bg-green-500 size-8 rounded-full flex-shrink-0">
                      <span className="text-white text-sm font-semibold">4</span>
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-sm font-semibold text-gray-800">
                        Follow on-screen instructions
                      </span>
                      <span className="text-xs text-gray-600">
                        You'll be redirected to either the registration page (new users) or dashboard (registered users).
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Close Button */}
            <div className="px-4 sm:px-5 pb-4 sm:pb-5">
              <button
                onClick={closeHowItWorksModal}
                className="cursor-pointer text-sm sm:text-base w-full px-4 py-2 border border-green-500 bg-green-500 text-white hover:border-green-600 hover:bg-green-600 active:border-green-700 active:bg-green-700 transition-colors duration-150 rounded-full flex items-center justify-center gap-2"
              >
                Got It
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Offline Modal - Redesigned */}
      {!isOnline && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 sm:p-5 z-50 overflow-y-auto"
        >
          <div className="rounded-2xl relative bg-white w-full max-w-md flex flex-col gap-3 mt-2 mb-2">

            {/* HEADER CARD */}
            <div className="flex relative rounded-t-2xl p-4 sm:p-5 text-white bg-linear-to-r from-red-500 via-red-400 to-red-500">
              <div className="flex flex-1 flex-col gap-1">
                <span className="text-xl sm:text-2xl font-bold">
                  Internet Unavailable
                </span>
                <span className="text-xs text-gray-100">
                  Connection Status
                </span>
              </div>
              <div className="absolute top-3 right-3 rounded-full p-2.5 sm:p-3 bg-red-600/40 shadow-red-600/40">
                <WifiOff className="size-5 sm:size-6" />
              </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="flex flex-col gap-3 p-4 sm:p-5">
              <div className="text-center flex flex-col gap-2">
                <span className="text-gray-500 text-sm">
                  Internet is currently unavailable. We are working to restore service.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
