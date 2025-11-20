"use client";

import {
  Headset,
  Loader2,
  MessageCircleWarning,
  CheckCircle,
  Info,
} from "lucide-react"; // Imported new icons
import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation"; // For redirection and URL params
import Link from "next/link";
import { db } from "@/app/config/firebase";
import { collection, addDoc, doc, updateDoc, serverTimestamp, getDoc, setDoc } from "firebase/firestore";

// Helper function to validate email format
const validateEmail = (email) => {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
};

// Simple password hashing function (for demo - use bcrypt/argon2 in production)
const hashPassword = async (password) => {
  // Check if crypto.subtle is available (only in secure contexts - HTTPS)
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    // Using Web Crypto API for hashing
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  } else {
    // Fallback for development/insecure contexts (HTTP)
    // Simple hash function (NOT secure - use proper hashing in production)
    let hash = 0;
    for (let i = 0; i < password.length; i++) {
      const char = password.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    // Convert to hex and pad
    return Math.abs(hash).toString(16).padStart(8, '0') + '_dev';
  }
};

// --- Timer Constants ---
const REGISTRATION_TIME_LIMIT_SECONDS = 300; // 5 minutes (not 10)

export default function Register() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get RFID and attempt from URL parameters
  const rfidFromUrl = searchParams.get("rfid");
  const attemptFromUrl = searchParams.get("attempt");
  
  // --- Actual Attempts from Firestore (prevents URL manipulation) ---
  const [actualAttempts, setActualAttempts] = useState(parseInt(attemptFromUrl) || 1);

  // --- Timer State ---
  const [timeLeft, setTimeLeft] = useState(REGISTRATION_TIME_LIMIT_SECONDS);
  const [timerStarted, setTimerStarted] = useState(false);
  const [timerLoading, setTimerLoading] = useState(true);

  // --- Form States (Your existing states) ---
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    rfid: rfidFromUrl || "1234567890", // Pre-fill with URL param or default
  });
  const [errors, setErrors] = useState({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [globalMessage, setGlobalMessage] = useState({
    type: null,
    text: null,
  });
  const [showInfoModal, setShowInfoModal] = useState(true); // Show info modal on mount
  const [registrationSuccess, setRegistrationSuccess] = useState(false); // Track successful registration
  
  // Use ref to prevent timer from running during redirect (more reliable than state)
  const isRedirectingRef = useRef(false);

  // --- Color Interpolation Logic (Adapted from the modal) ---
  const getColorForCountdown = useCallback(() => {
    const maxTime = REGISTRATION_TIME_LIMIT_SECONDS;
    const percentage = timeLeft / maxTime; // 1 (full green) -> 0 (full red)

    // Color Interpolation (Green -> Red)
    const r = Math.floor(255 * (1 - percentage));
    const g = Math.floor(255 * percentage);
    const b = 0;
    return `rgb(${r}, ${g}, ${b})`;
  }, [timeLeft]);

  // --- Initialize Timer from Firestore ---
  useEffect(() => {
    const initializeTimer = async () => {
      if (!rfidFromUrl) {
        setTimerLoading(false);
        return;
      }

      try {
        // Add timeout protection (30 seconds)
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Connection timeout")), 30000)
        );

        const userDocRef = doc(db, "users", rfidFromUrl);
        const userSnap = await Promise.race([
          getDoc(userDocRef),
          timeoutPromise
        ]);

        if (userSnap.exists()) {
          const userData = userSnap.data();
          
          // Set actual attempts from Firestore
          const attemptsFromFirestore = userData.attempts || 1;
          setActualAttempts(attemptsFromFirestore);
          console.log(`📊 Actual attempts from Firestore: ${attemptsFromFirestore}`);
          
          // ALWAYS RESET timer to 5 minutes for each new registration attempt
          // (Don't carry over old expired timers from previous attempts!)
          console.log("🔄 Resetting timer to 5 minutes for new registration attempt");
          
          await Promise.race([
            setDoc(userDocRef, {
              registrationTimerStart: serverTimestamp(), // Always update to NOW
            }, { merge: true }),
            timeoutPromise
          ]);
          
          setTimeLeft(REGISTRATION_TIME_LIMIT_SECONDS);
          console.log("✅ Timer set to", REGISTRATION_TIME_LIMIT_SECONDS, "seconds");
        }
        
        setTimerStarted(true);
        setTimerLoading(false);
      } catch (error) {
        console.error("Error initializing timer:", error);
        setTimerLoading(false);
        setTimerStarted(true);
      }
    };

    initializeTimer();
  }, [rfidFromUrl, router]);

  // --- Timer Countdown Logic ---
  useEffect(() => {
    // Don't run timer if not started, still loading, submitting, registration successful, or redirecting
    if (!timerStarted || timerLoading || isSubmitting || registrationSuccess || isRedirectingRef.current) return;

    if (timeLeft <= 0) {
      // Timer hit 0: Redirect user (only if registration not successful and not redirecting)
      if (!registrationSuccess && !isRedirectingRef.current) {
        console.log("⏰ TIMER EXPIRED - Redirecting to home");
        setGlobalMessage({
          type: "error",
          text: "Time limit reached. You will be redirected to the home screen.",
        });
        isRedirectingRef.current = true; // Prevent further timer triggers
        setTimeout(() => {
          console.log("🏠 Executing redirect to home page");
          router.push("/"); // Redirect to home page
        }, 2000);
      } else {
        console.log("⏰ Timer hit 0 but NOT redirecting (registrationSuccess:", registrationSuccess, ", isRedirecting:", isRedirectingRef.current, ")");
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prevTime) => prevTime - 1);
    }, 1000);

    return () => clearInterval(timer); // Cleanup function
  }, [timeLeft, timerStarted, timerLoading, isSubmitting, registrationSuccess, router]);

  // Format time (MM:SS)
  const formatTime = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
  };

  // --- 1. Validation Logic ---
  const validateField = (name, value) => {
    let error = null;
    const displayFieldName = name
      .replace(/([A-Z])/g, " $1")
      .replace(/^./, (str) => str.toUpperCase());

    if (!value.trim()) {
      error = `${displayFieldName} required`;
    } else if (name === "email" && !validateEmail(value)) {
      error = "Invalid email format";
    } else if (name === "password" && value.length < 8) {
      error = "Password must be at least 8 characters";
    } else if (name === "confirmPassword" && value !== formData.password) {
      error = "Passwords do not match";
    }
    return error;
  };

  const validateAllFields = () => {
    const newErrors = {};
    Object.keys(formData).forEach((name) => {
      if (name !== "rfid") {
        const error = validateField(name, formData[name]);
        if (error) {
          newErrors[name] = error;
        }
      }
    });
    
    // Additional validation for password match
    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = "Passwords do not match";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // --- 2. Event Handlers (Unchanged) ---
  const handleChange = (e) => {
    /* ... existing logic ... */
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setGlobalMessage({ type: null, text: null });
  };

  const handleBlur = (e) => {
    /* ... existing logic ... */
    const { name, value } = e.target;
    const error = validateField(name, value);
    setErrors((prev) => ({ ...prev, [name]: error }));
  };

  const handleFocus = (e) => {
    /* ... existing logic ... */
    setGlobalMessage({ type: null, text: null });
    setErrors((prev) => ({ ...prev, [e.target.name]: null }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setGlobalMessage({ type: null, text: null });

    const isValid = validateAllFields();

    if (!isValid || timeLeft <= 0) {
      if (timeLeft <= 0) {
        setGlobalMessage({
          type: "error",
          text: "Time limit reached. Please try again from the home screen.",
        });
      } else {
        setGlobalMessage({
          type: "error",
          text: "Please correct the errors marked in red before proceeding.",
        });
      }
      return;
    }

    // Save current time in case we need to restore it
    const savedTimeLeft = timeLeft;

    // ⚠️ CRITICAL: Stop timer IMMEDIATELY before doing anything else
    console.log("🛑 STOPPING TIMER - Starting registration process");
    console.log("   Time left before stop:", timeLeft);
    isRedirectingRef.current = true; // Set ref FIRST (most reliable)
    setRegistrationSuccess(true);
    setTimeLeft(999999);
    setIsSubmitting(true);
    console.log("   isRedirectingRef set to TRUE");

    try {
      // Hash password before storing (simple hash for now - use bcrypt in production)
      const hashedPassword = await hashPassword(formData.password);
      
      // Update the existing document (using RFID as document ID) to mark as registered
      const userDocRef = doc(db, "users", formData.rfid);
      
      const userData = {
        // RFID Information
        rfidCardId: formData.rfid,
        
        // Personal Information
        fullName: `${formData.firstName} ${formData.lastName}`,
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email.toLowerCase().trim(),
        
        // Authentication (for web portal access)
        passwordHash: hashedPassword,
        
        // Account Information
        balance: 0,
        status: "active",
        isRegistered: true,
        accountType: "user", // user, admin, etc.
        
        // Timestamps
        registeredAt: serverTimestamp(),
        lastLogin: serverTimestamp(),
        updatedAt: serverTimestamp(),
        
        // Attempts (reset after successful registration)
        attempts: 0,
        
        // Additional metadata
        registrationMethod: "rfid_scan",
        registrationAttempt: actualAttempts,
      };

      // Create or update the document (handles both new users and users with previous attempts)
      // Remove the timer start field as registration is complete
      await setDoc(userDocRef, {
        ...userData,
        registrationTimerStart: null, // Clear timer
      }, { merge: true });
      
      console.log("✅ User registered successfully:", formData.rfid);
      console.log("✅ isRedirectingRef is:", isRedirectingRef.current);
      console.log("✅ registrationSuccess is:", true);

      // Show success message
      setGlobalMessage({
        type: "success",
        text: "Registration successful! Redirecting to dashboard...",
      });

      // Redirect to dashboard after 2 seconds
      setTimeout(() => {
        console.log("📊 Executing redirect to dashboard");
        setIsSubmitting(false);
        // Redirect to dashboard with RFID parameter
        router.push(`/dashboard?rfid=${encodeURIComponent(formData.rfid)}`);
      }, 2000);
    } catch (error) {
      console.error("❌ Error registering user:", error);
      isRedirectingRef.current = false; // Reset ref if registration fails
      setIsSubmitting(false);
      setRegistrationSuccess(false); // Reset flag if registration fails
      setTimeLeft(savedTimeLeft); // Restore timer
      setGlobalMessage({
        type: "error",
        text: `Registration failed: ${error.message}`,
      });
    }
  };

  const getInputClass = (name) => {
    const base =
      "px-3 py-2 rounded-md outline-none border transition-colors duration-150 placeholder:text-gray-500";
    if (name === "rfid") {
      return `${base} border-gray-300 bg-gray-100/80 text-gray-500`;
    }
    const borderClass = errors[name]
      ? "border-red-400 focus:border-red-400"
      : "border-gray-300 focus:border-green-500";
    return `${base} ${borderClass}`;
  };

  return (
    <div className="min-h-dvh text-sm sm:text-base flex flex-col items-center justify-center p-3 sm:p-4 md:px-0 bg-white">
      {/* Information Modal */}
      {showInfoModal && (
        <div className="min-h-dvh flex flex-col items-center justify-center fixed inset-0 w-full bg-black/50 p-3 sm:p-4 md:px-0 z-50">
          <div className="bg-white rounded-2xl p-6 flex flex-col gap-5 w-full max-w-md">
            {/* Icon */}
            <div className="flex items-center justify-center">
              <div className="bg-green-100 rounded-full p-4">
                <Info className="text-green-600 size-10 sm:size-12" />
              </div>
            </div>

            {/* Title */}
            <div className="text-center flex flex-col gap-2">
              <span className="text-xl sm:text-2xl font-bold">
                Registration Information
              </span>
            </div>

            {/* Information Points */}
            <div className="flex flex-col gap-4">
              {/* Point 1: Free Internet */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-green-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">1</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm sm:text-base">
                    Free Internet Access
                  </span>
                  <span className="text-gray-600 text-xs sm:text-sm">
                    You have complimentary internet access during the registration process. Complete your registration within 5 minutes.
                  </span>
                </div>
              </div>

              {/* Point 2: 3 Attempts Limit */}
              <div className="flex items-start gap-3 p-3 rounded-lg bg-orange-50 border border-orange-200">
                <div className="flex items-center justify-center min-w-6 min-h-6 bg-orange-500 rounded-full mt-0.5">
                  <span className="text-white text-sm font-semibold">2</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="font-semibold text-sm sm:text-base">
                    Limited Attempts
                  </span>
                  <span className="text-gray-600 text-xs sm:text-sm">
                    You have <span className="font-semibold text-orange-600">3 attempts maximum</span> to complete your registration. After 3 attempts, you will need to contact an administrator.
                  </span>
                </div>
              </div>
            </div>

            {/* Current Attempt Counter */}
            <div className="text-center py-2 px-4 bg-gray-100 rounded-lg">
              <span className="text-sm text-gray-600">
                Current Attempt: <span className="font-semibold text-orange-600">{actualAttempts} of 3</span>
              </span>
            </div>

            {/* OK Button */}
            <button
              onClick={() => setShowInfoModal(false)}
              disabled={timerLoading}
              className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-400 text-white font-semibold rounded-full transition-colors"
            >
              {timerLoading ? "Loading..." : "I Understand"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-5 sm:gap-6 w-full max-w-md ">
        {/* Intro */}
        <div className="flex text-center flex-col pt-2">
          <span className="text-xl sm:text-2xl font-bold">
            Welcome <span className="text-green-500">New User</span>
          </span>
          <span className="text-gray-500 text-sm">Create your account</span>
        </div>

        {/* Dynamic Timer Display */}
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="flex flex-col text-center gap-1">
            <span className="text-sm sm:text-base">Time remaining</span>
            <span className="text-gray-500 text-xs sm:text-sm">
              ( {actualAttempts} out of 3 attempts )
            </span>
          </div>
          <span
            className="text-3xl sm:text-4xl font-semibold tabular-nums"
            // Apply dynamic color to the timer text
            style={{
              color: getColorForCountdown(),
              transition: "color 0.5s ease-out",
            }}
          >
            {formatTime(timeLeft)}
          </span>
        </div>

        {/* Dynamic Global Validation Message */}
        {globalMessage.text /* ... JSX remains the same ... */ && (
          <div
            className={`px-4 py-2 rounded-md flex items-center gap-2 sm:gap-3 text-sm border-l-3 ${
              globalMessage.type === "error"
                ? "bg-red-100 text-red-500 border-red-500"
                : "bg-green-100 text-green-500 border-green-500"
            }`}
          >
            {globalMessage.type === "error" ? (
              <MessageCircleWarning className="size-6 sm:size-7" />
            ) : (
              <CheckCircle className="size-6 sm:size-7" />
            )}
            <span className="text-xs sm:text-sm">{globalMessage.text}</span>
          </div>
        )}

        {/* main form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {/* first and last fields */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-1 flex flex-col gap-1">
              <label
                htmlFor="firstName"
                className="text-xs sm:text-sm text-gray-800"
              >
                First Name
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                value={formData.firstName}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                className={getInputClass("firstName")}
                placeholder="e.g. Juan"
                disabled={isSubmitting || timeLeft <= 0}
              />
              {errors.firstName && (
                <span className="text-xs text-red-400">{errors.firstName}</span>
              )}
            </div>

            <div className="col-span-1 flex flex-col gap-1">
              <label
                htmlFor="lastName"
                className="text-xs sm:text-sm text-gray-800"
              >
                Last Name
              </label>
              <input
                id="lastName"
                name="lastName"
                type="text"
                value={formData.lastName}
                onChange={handleChange}
                onBlur={handleBlur}
                onFocus={handleFocus}
                className={getInputClass("lastName")}
                placeholder="e.g. Dela Cruz"
                disabled={isSubmitting || timeLeft <= 0}
              />
              {errors.lastName && (
                <span className="text-xs text-red-400">{errors.lastName}</span>
              )}
            </div>
          </div>
          {/* RFID */}
          <div className="flex flex-col gap-1">
            <label htmlFor="rfid" className="text-xs sm:text-sm text-gray-800">
              RFID Card No.
            </label>
            <input
              id="rfid"
              name="rfid"
              type="text"
              value={formData.rfid}
              className={getInputClass("rfid")}
              placeholder="Card number detected"
              readOnly
              disabled={isSubmitting || timeLeft <= 0}
            />
            {rfidFromUrl && (
              <span className="text-xs text-green-600">
                ✓ Card detected and auto-filled
              </span>
            )}
          </div>
          {/* Email */}
          <div className="flex flex-col gap-1">
            <label htmlFor="email" className="text-xs sm:text-sm text-gray-800">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              value={formData.email}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              className={getInputClass("email")}
              placeholder="e.g. name@example.com"
              disabled={isSubmitting || timeLeft <= 0}
            />
            {errors.email && (
              <span className="text-xs text-red-400">{errors.email}</span>
            )}
          </div>
          {/* password */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="password"
              className="text-xs sm:text-sm text-gray-800"
            >
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              value={formData.password}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              className={getInputClass("password")}
              placeholder="Must be at least 8 characters long"
              disabled={isSubmitting || timeLeft <= 0}
            />
            {errors.password && (
              <span className="text-xs text-red-400">{errors.password}</span>
            )}
          </div>
          {/* confirm password */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="confirmPassword"
              className="text-xs sm:text-sm text-gray-800"
            >
              Confirm password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="confirmPassword"
              value={formData.confirmPassword}
              onChange={handleChange}
              onBlur={handleBlur}
              onFocus={handleFocus}
              className={getInputClass("confirmPassword")}
              placeholder="Re-enter your password"
              disabled={isSubmitting || timeLeft <= 0}
            />
            {errors.confirmPassword && (
              <span className="text-xs text-red-400">
                {errors.confirmPassword}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-2 my-2">
            {/* Register Button (Submission State) */}
            <button
              type="submit"
              className={`flex  items-center justify-center gap-2 px-4 py-2 rounded-full text-white transition-colors duration-150 ${
                isSubmitting || timeLeft <= 0 // Disable button if submitting or time is up
                  ? "bg-green-700 cursor-not-allowed"
                  : "bg-green-500 hover:bg-green-500/90 active:bg-green-600 cursor-pointer"
              }`}
              disabled={isSubmitting || timeLeft <= 0}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-5 animate-spin" />
                  <span>Registering...</span>
                </>
              ) : (
                <span>Register</span>
              )}
            </button>

            <Link
              href="/"
              className={`flex  items-center justify-center gap-2 px-4 border border-gray-300 py-2 rounded-full transition-colors duration-150 ${
                isSubmitting || timeLeft <= 0 // Disable link if submitting or time is up
                  ? "bg-gray-100 cursor-not-allowed"
                  : "hover:bg-gray-50 active:bg-gray-100 cursor-pointer"
              }`}
              disabled={isSubmitting || timeLeft <= 0}
            >
              Back to Captive Portal
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
