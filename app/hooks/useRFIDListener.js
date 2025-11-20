"use client";

import { useState, useEffect, useRef } from "react";
import { realtimeDb } from "@/app/config/firebase";
import { ref, onValue, off } from "firebase/database";

/**
 * Custom hook to listen for RFID card scans from ESP8266
 * Listens to Firebase Realtime Database and triggers callback when new card is detected
 * 
 * @param {string} dbPath - Path in Realtime Database (e.g., 'rfid/lastScan')
 * @param {function} onCardDetected - Callback when card is detected
 * @param {boolean} isListening - Whether to actively listen (default: true)
 */
export function useRFIDListener(dbPath = "rfid/lastScan", onCardDetected, isListening = true) {
  const [rfidData, setRfidData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const previousCardIdRef = useRef(null);
  const previousTimestampRef = useRef(null);

  useEffect(() => {
    if (!isListening || !dbPath) {
      setLoading(false);
      return;
    }

    // Reference to the RFID data in Realtime Database
    const rfidRef = ref(realtimeDb, dbPath);

    // Set up the listener
    const unsubscribe = onValue(
      rfidRef,
      (snapshot) => {
        setLoading(false);
        setIsConnected(true);

        if (snapshot.exists()) {
          const data = snapshot.val();
          setRfidData(data);

          // Extract card ID and timestamp
          // Adjust these fields based on your ESP8266 data structure
          const cardId = data.cardId || data.uid || data.id || data;
          const timestamp = data.timestamp || Date.now();

          // Check if scan is recent (within last 10 seconds)
          const now = Date.now();
          const scanAge = now - timestamp;
          const MAX_SCAN_AGE = 10000; // 10 seconds

          if (scanAge > MAX_SCAN_AGE) {
            console.log(`⏰ Ignoring old scan (${Math.floor(scanAge / 1000)}s old):`, cardId);
            return; // Ignore scans older than 10 seconds
          }

          // Only trigger callback if this is a NEW card scan
          // (different card ID OR same card with new timestamp)
          const isNewScan =
            cardId !== previousCardIdRef.current ||
            timestamp !== previousTimestampRef.current;

          if (isNewScan && cardId) {
            console.log("New RFID card detected:", cardId, `(${Math.floor(scanAge / 1000)}s old)`);
            
            // Update refs
            previousCardIdRef.current = cardId;
            previousTimestampRef.current = timestamp;

            // Trigger callback with card data
            if (onCardDetected) {
              onCardDetected({
                cardId,
                timestamp,
                rawData: data,
              });
            }
          } else {
            console.log("Duplicate scan ignored:", cardId);
          }
        } else {
          setRfidData(null);
          setError("No data available at this path");
        }
      },
      (err) => {
        setLoading(false);
        setIsConnected(false);
        setError(err.message);
        console.error("Firebase Realtime Database error:", err);
      }
    );

    // Cleanup listener on unmount or when dependencies change
    return () => {
      off(rfidRef, "value", unsubscribe);
    };
  }, [dbPath, onCardDetected, isListening]);

  return {
    rfidData,
    loading,
    error,
    isConnected,
  };
}

