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
  GRACE_PERIOD_USED: "GRACE_PERIOD_USED", // NEW: Grace period already used + zero balance
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
  
  // NEW: Scanning state control
  const [isScanning, setIsScanning] = useState(false);
  const [scanTimeout, setScanTimeout] = useState(30); // 30 second timeout
  
  // NEW: Active session detection
  const [activeSession, setActiveSession] = useState(null); // {rfid, timeRemaining}

  // SIMPLIFIED: ESP32 does all the checking!
  // Frontend only polls when user clicks "Start Scan"
  // ESP32 automatically detects client IP from HTTP request

  // Handle RFID card detection from ESP32 (SIMPLIFIED!)
  // ESP32 now ONLY sends: {cardId, isRegistered}
  // Frontend handles everything else (attempt tracking, user data, etc.)
  const handleCardDetected = useCallback(
    async (cardData) => {
      console.log("📡 RFID Result from ESP32:", cardData);
      
      // STOP SCANNING (card detected!)
      setIsScanning(false);
      
      // Extract SIMPLE data from ESP32
      const { cardId, isRegistered } = cardData.rawData || cardData;
      
      setScannedCardId(cardId);

      // Show checking modal briefly
      setModalState(MODAL_STATE.CHECKING);
      
      // Give user time to see the "checking" state
      await new Promise(resolve => setTimeout(resolve, 1000));

      // ESP32 says: User is REGISTERED
      if (isRegistered) {
        console.log("✅ ESP32 verified: User is REGISTERED");
        
        // Get balance and grace period DATE from ESP32
        const { balance = 0, lastGracePeriodDate = "" } = cardData.rawData || cardData;
        
        // Frontend does the date comparison (ESP32 has no RTC!)
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const gracePeriodUsedToday = (lastGracePeriodDate === today);
        
        console.log("💰 User balance (from ESP32):", balance);
        console.log("📅 Last grace period date (from ESP32):", lastGracePeriodDate || "Never");
        console.log("📅 Today's date (from device):", today);
        console.log("🎁 Grace period used today:", gracePeriodUsedToday);
        
        setModalState(MODAL_STATE.REGISTERED);
        
        // Wait 1.5 seconds, then check balance and grace period
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Check if user has zero balance AND grace period already used today
        if (balance === 0 && gracePeriodUsedToday) {
          console.log("⚠️ Zero balance + grace period already used today!");
          setModalState(MODAL_STATE.GRACE_PERIOD_USED);
          return; // Don't grant access or redirect
        }
        
        setModalState(MODAL_STATE.GRANTING_ACCESS);
        console.log("🌐 Granting internet access for registered user...");
        
        // For REGISTERED users, frontend calls Orange Pi API directly
        // (ESP32 only grants access for UNREGISTERED users)
        try {
          const orangePiUrl = "http://192.168.1.1:8080/grant-time?duration=300";
          console.log("📡 Calling Orange Pi API:", orangePiUrl);
          
          const grantResponse = await fetch(orangePiUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(5000)
          });
          
          if (grantResponse.ok) {
            const data = await grantResponse.json();
            console.log("✅ Orange Pi confirmed: Internet access granted!", data);
            
            // Notify ESP32 to play success beeps/LED
            try {
              await fetch(`${process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10"}/notify-success`, {
                method: 'GET',
                signal: AbortSignal.timeout(2000)
              });
              console.log("🔔 ESP32 notified - Success feedback triggered");
            } catch (err) {
              console.log("⚠️ Could not notify ESP32 for feedback (non-critical)");
            }
            
            // Wait a moment for network rules to apply
            await new Promise(resolve => setTimeout(resolve, 1000));
            
            // Redirect to dashboard
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
        
      // ESP32 says: User is NOT REGISTERED
      } else {
        console.log("⚠️ ESP32 verified: NOT REGISTERED");
        
        // Get attempts from ESP32 response
        const { attempts = 0, attemptsExceeded = false } = cardData.rawData || cardData;
        
        console.log(`📊 Current attempts: ${attempts}/${MAX_ATTEMPTS}`);
        setCurrentAttempts(attempts);
        
        // Check if max attempts exceeded (ESP32 already checked Firestore!)
        if (attemptsExceeded || attempts >= MAX_ATTEMPTS) {
          console.log("🔒 Max attempts reached - BLOCKED!");
          setModalState(MODAL_STATE.ATTEMPTS_EXCEEDED);
          return; // Don't grant access or redirect
        }
        
        // Track/increment attempts in Firestore for next scan
        try {
          const userDocRef = doc(db, "users", cardId);
          const userSnap = await getDoc(userDocRef);
          
          const newAttempts = attempts + 1;
          
          if (userSnap.exists()) {
            // User doc exists - increment attempts
            await updateDoc(userDocRef, {
              attempts: newAttempts,
              lastAttempt: serverTimestamp(),
            });
          } else {
            // First scan - create user doc
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
          // Continue anyway
        }
        
        setModalState(MODAL_STATE.UNREGISTERED);
        
        // Wait 1.5 seconds, then show granting access
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        setModalState(MODAL_STATE.GRANTING_ACCESS);
        console.log("🌐 Granting 5-minute trial access...");
        
        // Poll ESP32 to check if trial access was granted
        const esp32Url = process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10";
        let accessGranted = false;
        let pollAttempts = 0; // Renamed to avoid conflict
        const maxPollAttempts = 10; // Try for 10 seconds
        
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
          return; // DON'T redirect!
        }
        
        // Only redirect if trial access was confirmed!
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
          // Check if session is still valid (has time remaining)
          if (session.sessionEndTime && session.sessionEndTime > Date.now()) {
            const timeRemaining = Math.floor((session.sessionEndTime - Date.now()) / 1000);
            setActiveSession({
              rfid: session.rfid,
              timeRemaining: timeRemaining,
              sessionEndTime: session.sessionEndTime
            });
            console.log("✅ Active session detected:", session.rfid, "Time remaining:", timeRemaining, "seconds");
          } else {
            // Session expired, clear it
            sessionStorage.removeItem('ezvendo_active_session');
            console.log("⏰ Session expired, cleared from storage");
          }
        }
      } catch (error) {
        console.error("Error checking active session:", error);
      }
    };

    checkActiveSession();
    
    // Check every 5 seconds to update time remaining
    const interval = setInterval(checkActiveSession, 5000);
    
    return () => clearInterval(interval);
  }, []);

  // Check ESP32 connection status (always check, separate from scanning)
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
    
    // Check immediately
    checkConnection();
    
    // Then check every 5 seconds
    const interval = setInterval(checkConnection, 5000);
    
    return () => clearInterval(interval);
  }, []);
  
  // Poll ESP32 for RFID scans ONLY when scanning is active
  const { rfidData, loading: rfidLoading, error: rfidError } = useESP8266Polling(
    process.env.NEXT_PUBLIC_ESP8266_IP || "http://192.168.1.10", // ESP32 IP from env or default
    handleCardDetected,
    isScanning, // Only poll /rfid/latest when scanning is active!
    1000 // Poll every 1 second
    // No need to pass client IP - ESP32 detects it automatically from HTTP request
  );
  
  // Countdown timer for scan timeout
  useEffect(() => {
    if (!isScanning) {
      setScanTimeout(30); // Reset to 30 seconds
      return;
    }
    
    const timer = setInterval(() => {
      setScanTimeout((prev) => {
        if (prev <= 1) {
          // Timeout reached - stop scanning
          setIsScanning(false);
          console.log("⏱️ Scan timeout - stopped");
          return 30;
        }
        return prev - 1;
      });
    }, 1000);
    
    return () => clearInterval(timer);
  }, [isScanning]);
  
  // Handler for "Start Scan" button
  const handleStartScan = () => {
    console.log("🔍 Starting RFID scan...");
    setIsScanning(true);
    setScanTimeout(30);
  };
  
  // Handler for "Stop Scan" button
  const handleStopScan = () => {
    console.log("🛑 Scan stopped by user");
    setIsScanning(false);
  };

  // Online/Offline detection
  useEffect(() => {
    // Set the initial state when component mounts (only runs in browser)
    if (typeof navigator !== "undefined") {
      setIsOnline(navigator.onLine);
    }

    // Create event handlers
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    // Add event listeners
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline); // Cleanup listeners on component unmount

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);
  return (
    <div className="min-h-dvh container mx-auto w-full max-w-md text-xs sm:text-base">
      {/* Main */}
      <div className="flex flex-col gap-6 p-3 sm:p-4 md:px-0">
        {/* Header */}
        <div className="hidden items-center justify-between w-full">
          {/* Left */}
          logo here
          {/* Right */}
          <div className="flex items-center justify-center flex-col gap-1">
            toggle?
          </div>
        </div>

        {/* Center */}
        <div className="flex flex-col gap-3 sm:gap-4 w-full">
          {/* main */}
          <div className="flex flex-col gap-4 w-full">
            {/* Intro */}
            <div className="flex text-center flex-col py-1">
              <span className="text-xl sm:text-2xl font-bold">
                Welcome to EZ-Vendo
              </span>
              <span className="text-gray-500 text-xs sm:text-sm">
                Secure and convenient vending experience.
              </span>
            </div>

            {/* Active Session Card (if exists) */}
            {activeSession && (
              <div className="bg-gradient-to-r from-green-50 to-green-100 p-5 rounded-3xl border-2 border-green-300 shadow-xl flex flex-col gap-4 items-center">
                <div className="flex items-center gap-2">
                  <div className="bg-green-500 p-2 rounded-full animate-pulse">
                    <Clock className="text-white size-5" />
                  </div>
                  <span className="font-bold text-lg text-green-900">Active Session Found</span>
                </div>
                
                <div className="flex flex-col items-center gap-2">
                  <span className="text-sm text-gray-700">Time Remaining</span>
                  <span className="text-4xl font-bold text-green-600 tabular-nums">
                    {Math.floor(activeSession.timeRemaining / 60)}:{String(activeSession.timeRemaining % 60).padStart(2, '0')}
                  </span>
                  <span className="text-xs text-gray-600">Your internet is still active</span>
                </div>
                
                <button
                  onClick={() => router.push(`/dashboard?rfid=${encodeURIComponent(activeSession.rfid)}`)}
                  className="w-full px-6 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold rounded-full shadow-lg hover:shadow-xl transition-all"
                >
                  Return to Dashboard
                </button>
                
                <span className="text-xs text-gray-500">
                  RFID: {activeSession.rfid}
                </span>
              </div>
            )}

            {/* Main */}
            <div className="bg-white p-4 rounded-2xl border border-gray-300/80 flex flex-col gap-3 items-center">
              <div className="flex flex-col gap-1 text-center pt-2">
                <span className="text-xl sm:text-2xl font-bold">
                  {!isConnected ? (
                    <>
                      <span className="text-gray-500">Scanner Offline</span>
                    </>
                  ) : isScanning ? (
                    <>
                      <span className="text-green-500">Scanning</span> for Cards
                    </>
                  ) : (
                    <>Ready to Scan</>
                  )}
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  {!isConnected
                    ? "Waiting for RFID scanner..."
                    : isScanning
                    ? "Tap your card now"
                    : "Click 'Start Scan' to begin"}
                </span>
              </div>
              
              {/* Scan button with animation */}
              <div className="w-full flex flex-col items-center justify-center gap-4 my-3">
                {/* Animated area */}
                <div className="relative flex items-center justify-center size-62">
                  {/* Animated circles - only show when scanning */}
                  {isScanning && (
                    <>
                      <div className="absolute rounded-full size-64 bg-green-200 animate-concentric-pulse [animation-delay:-1s]"></div>
                      <div className="absolute rounded-full size-52 bg-green-300 animate-concentric-pulse [animation-delay:0s]"></div>
                    </>
                  )}

                  {/* Center button/indicator */}
                  {!isScanning ? (
                    // START SCAN BUTTON (when not scanning)
                    <button
                      onClick={handleStartScan}
                      disabled={!isConnected}
                      className="
                        relative                      
                        flex items-center justify-center
                        rounded-full
                        size-38                    
                        bg-green-500
                        hover:bg-green-600
                        disabled:bg-gray-400
                        disabled:cursor-not-allowed
                        text-white
                        text-lg
                        font-semibold
                        shadow-lg
                        transition-all
                      "
                    >
                      Start Scan
                    </button>
                  ) : (
                    // COUNTDOWN TIMER (when scanning)
                    <div className="
                      relative
                      flex items-center justify-center
                      rounded-full
                      size-38                    
                      bg-green-400
                      text-white
                      text-2xl
                      font-bold
                      shadow
                    ">
                      {scanTimeout}
                    </div>
                  )}
                </div>
                
                {/* Stop Scanning button - below the circles */}
                {isScanning && (
                  <button
                    onClick={handleStopScan}
                    className="text-sm text-gray-600 hover:text-gray-800 underline"
                  >
                    Stop Scanning
                  </button>
                )}
              </div>
              {/* note for unregistered user */}
              <div className="flex items-center gap-3 p-3 sm:p-4 rounded-lg bg-gray-100">
                <div className="flex items-center">
                  <div className="bg-green-500 rounded-full">
                    <Info className="text-white" />
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-gray-700 text-xs sm:text-sm font-semibold">
                    How it works:
                  </span>
                  <ul className="text-gray-600 text-xs list-disc list-inside">
                    <li><span className="font-semibold">New user?</span> Tap your card to get 5 minutes free to register (3 attempts max)</li>
                    <li><span className="font-semibold">Registered?</span> Tap your card to access dashboard and start browsing</li>
                    <li><span className="font-semibold">Billing:</span> Pay per minute based on your balance</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* how to use */}
          <div className="bg-white p-3 sm:p-4 border border-gray-300/80 rounded-2xl flex flex-col gap-3 sm:gap-4 items-center">
            {/* header */}
            <div className="flex items-center gap-2 py-2">
              <div className="flex items-center">
                <div className="bg-green-500 rounded-full">
                  <CircleQuestionMark className="text-white" />
                </div>
              </div>
              <span className="text-base sm:text-lg font-semibold">
                How to use?
              </span>
            </div>

            {/* instructions */}
            <div className="flex flex-col gap-3 sm:gap-4 pb-2">
              {/* #1 */}
              <div className="flex items-center gap-3">
                {/* number */}
                <div className="flex items-center justify-center text-center bg-green-500 size-6 rounded-full">
                  <span className="text-white text-xs">1</span>
                </div>
                {/* information */}
                <span className="text-sm text-gray-700">
                  Click "Start Scan" button
                </span>
              </div>
              {/* #2 */}
              <div className="flex items-center gap-3">
                {/* number */}
                <div className="flex items-center justify-center text-center bg-green-500 size-6 rounded-full">
                  <span className="text-white text-xs">2</span>
                </div>
                {/* information */}
                <span className="text-sm text-gray-700">
                  Hold your RFID Card near the reader
                </span>
              </div>
              {/* #3 */}
              <div className="flex items-center gap-3">
                {/* number */}
                <div className="flex items-center justify-center text-center bg-green-500 size-6 rounded-full">
                  <span className="text-white text-xs">3</span>
                </div>
                {/* information */}
                <span className="text-sm text-gray-700">
                  Wait for card recognition
                </span>
              </div>
              {/* #4 */}
              <div className="flex items-center gap-3">
                {/* number */}
                <div className="flex items-center justify-center text-center bg-green-500 size-6 rounded-full">
                  <span className="text-white text-xs">4</span>
                </div>
                {/* information */}
                <span className="text-sm text-gray-700">
                  Follow on-screen instructions
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Contact admin */}
        <div className="flex flex-col items-center justify-center gap-1 mb-2">
          <span className="text-gray-500 text-xs sm:text-sm">
            Having trouble?
          </span>
          <button className="flex items-center gap-1 text-green-500 font-semibold text-xs sm:text-sm">
            <Headset className="text-green-500 size-4" />
            Contact Support
          </button>
        </div>
      </div>

      {/* RFID Detection Modal */}
      {modalState !== MODAL_STATE.HIDDEN && (
        <div className="min-h-dvh flex flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl p-6 flex flex-col items-center justify-center gap-4 w-full max-w-md relative">
            {/* Close button for attempts exceeded and grace period used */}
            {(modalState === MODAL_STATE.ATTEMPTS_EXCEEDED || modalState === MODAL_STATE.GRACE_PERIOD_USED) && (
              <button
                onClick={() => setModalState(MODAL_STATE.HIDDEN)}
                className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
              >
                <X className="size-5" />
              </button>
            )}

            {/* Icon and Content based on state */}
            <div className="relative flex items-center justify-center py-4">
              {/* Pulsing circles for checking and granting access states */}
              {(modalState === MODAL_STATE.CHECKING || modalState === MODAL_STATE.GRANTING_ACCESS) && (
                <>
                  <div className="absolute rounded-full size-22 bg-green-200 animate-concentric-pulse [animation-delay:-1s]"></div>
                  <div className="absolute rounded-full size-16 bg-green-300 animate-concentric-pulse [animation-delay:0s]"></div>
                </>
              )}

              {/* Center Icon */}
              {modalState === MODAL_STATE.CHECKING && (
                <div className="bg-green-400 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <Search className="text-white size-7 sm:size-8 animate-pulse" />
                </div>
              )}

              {modalState === MODAL_STATE.GRANTING_ACCESS && (
                <div className="bg-blue-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <Wifi className="text-white size-7 sm:size-8 animate-pulse" />
                </div>
              )}

              {modalState === MODAL_STATE.REGISTERED && (
                <div className="bg-green-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <CheckCircle className="text-white size-7 sm:size-8" />
                </div>
              )}

              {modalState === MODAL_STATE.UNREGISTERED && (
                <div className="bg-orange-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <UserPlus className="text-white size-7 sm:size-8" />
                </div>
              )}

              {modalState === MODAL_STATE.ATTEMPTS_EXCEEDED && (
                <div className="bg-red-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <X className="text-white size-7 sm:size-8" />
                </div>
              )}

              {modalState === MODAL_STATE.GRACE_PERIOD_USED && (
                <div className="bg-orange-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <BanknoteX className="text-white size-7 sm:size-8" />
                </div>
              )}

              {modalState === MODAL_STATE.ERROR && (
                <div className="bg-red-500 size-12 sm:size-14 flex items-center justify-center relative rounded-full z-50">
                  <X className="text-white size-7 sm:size-8" />
                </div>
              )}
            </div>

            {/* Message Content */}
            <div className="text-center flex flex-col gap-2">
              {modalState === MODAL_STATE.CHECKING && (
                <>
                  <span className="text-lg sm:text-xl font-semibold">
                    Checking Card...
                  </span>
                  <span className="text-gray-500 text-sm">
                    Card ID: {scannedCardId}
                  </span>
                </>
              )}

              {modalState === MODAL_STATE.GRANTING_ACCESS && (
                <>
                  <span className="text-lg sm:text-xl font-semibold text-blue-600">
                    Granting Internet Access...
                  </span>
                  <span className="text-gray-500 text-sm">
                    Please wait
                  </span>
                  <span className="text-gray-500 text-xs animate-pulse">
                    Configuring network access...
                  </span>
                </>
              )}

              {modalState === MODAL_STATE.REGISTERED && (
                <>
                  <span className="text-lg sm:text-xl font-semibold text-green-600">
                    Card Registered!
                  </span>
                  <span className="text-gray-500 text-sm">
                    Card ID: {scannedCardId}
                  </span>
                  <span className="text-gray-500 text-xs">
                    Preparing dashboard...
                  </span>
                </>
              )}

              {modalState === MODAL_STATE.UNREGISTERED && (
                <>
                  <span className="text-lg sm:text-xl font-semibold text-orange-600">
                    Card Not Registered
                  </span>
                  <span className="text-gray-500 text-sm">
                    Card ID: {scannedCardId}
                  </span>
                  <span className="text-gray-600 text-sm font-semibold">
                    Attempt: {currentAttempts}/{MAX_ATTEMPTS}
                  </span>
                  <span className="text-gray-500 text-xs">
                    Preparing registration...
                  </span>
                </>
              )}

              {modalState === MODAL_STATE.ATTEMPTS_EXCEEDED && (
                <>
                  <span className="text-lg sm:text-xl font-semibold text-red-600">
                    Maximum Attempts Reached
                  </span>
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
                  <span className="text-lg sm:text-xl font-semibold text-orange-600">
                    Grace Period Already Used
                  </span>
                  <span className="text-gray-500 text-sm">
                    Your balance is zero and you've already used your free 5-minute grace period today.
                  </span>
                  
                  {/* Information Cards */}
                  <div className="flex flex-col gap-3 mt-3 w-full">
                    {/* Top-up via App */}
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200">
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
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
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

              {modalState === MODAL_STATE.ERROR && (
                <>
                  <span className="text-lg sm:text-xl font-semibold text-red-600">
                    Error
                  </span>
                  <span className="text-gray-500 text-sm">
                    {errorMessage || "Failed to check card"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Offline Modal */}
      {!isOnline && (
        <div className="flex min-h-dvh flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl py-6 px-4 flex flex-col items-center justify-center gap-5 w-full max-w-md">
            <div className="bg-red-100 size-12 sm:size-13 flex items-center justify-center relative rounded-full z-50">
              <WifiOff className="text-red-500 size-6 sm:size-7" />
            </div>
            <div className="flex flex-col items-center justify-center gap-2 ">
              <div className="flex flex-col text-center">
                <span className="text-base sm:text-lg font-semibold">
                  Internet Unavailable
                </span>
                <span className="text-gray-500 text-xs sm:text-sm">
                  Internet is currently unavailable. We are working to restore
                  service.
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
