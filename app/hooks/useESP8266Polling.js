"use client";

import { useState, useEffect } from "react";

/**
 * Custom hook to poll ESP32 HTTP server for RFID scan results
 * Polls the local ESP32 server and triggers callback when new card is detected
 * 
 * @param {string} esp8266Url - ESP32 IP address (e.g., 'http://192.168.1.10')
 * @param {function} onCardDetected - Callback when new card is detected
 * @param {boolean} isListening - Whether to actively poll (default: true)
 * @param {number} pollingInterval - Poll interval in ms (default: 1000)
 */
export function useESP8266Polling(
  esp8266Url = "http://192.168.1.10",
  onCardDetected,
  isListening = true,
  pollingInterval = 1000
) {
  const [rfidData, setRfidData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    if (!isListening || !esp8266Url) {
      setLoading(false);
      return;
    }

    let pollTimer;

    const pollESP8266 = async () => {
      try {
        // Poll the ESP32 /rfid/latest endpoint
        // ESP32 will automatically detect client IP from the HTTP request
        const response = await fetch(`${esp8266Url}/rfid/latest`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          // Timeout after 5 seconds
          signal: AbortSignal.timeout(5000)
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json();
        
        setLoading(false);
        setIsConnected(true);
        setError(null);

        // Check if ESP8266 has data (not just "waiting" status)
        if (data.status === "waiting") {
          // No card scanned yet, continue polling
          return;
        }

        // ESP32 auto-clears after sending, so any "success" status is a NEW scan
        console.log("📡 New scan detected from ESP32");
        console.log("✅ Processing scan:", data.cardId);
        
        setRfidData(data);

        // Trigger callback with card data
        if (onCardDetected) {
          onCardDetected({
            cardId: data.cardId,
            timestamp: data.timestamp,
            rawData: data,
          });
        }

      } catch (err) {
        setLoading(false);
        setIsConnected(false);
        
        // Only set error if it's not a timeout (timeout is expected during polling)
        if (err.name !== 'TimeoutError' && err.name !== 'AbortError') {
          setError(err.message);
          console.error("Error polling ESP8266:", err.message);
        }
      }
    };

    // Initial poll
    pollESP8266();

    // Set up polling interval
    pollTimer = setInterval(pollESP8266, pollingInterval);

    // Cleanup on unmount
    return () => {
      if (pollTimer) {
        clearInterval(pollTimer);
      }
    };
  }, [esp8266Url, onCardDetected, isListening, pollingInterval]);

  return {
    rfidData,
    loading,
    error,
    isConnected,
  };
}


