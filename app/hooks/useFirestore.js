"use client";

import { useState } from "react";
import { db } from "@/app/config/firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
} from "firebase/firestore";

/**
 * Custom hook for Firestore operations
 * Provides CRUD operations for Firestore database
 */
export function useFirestore(collectionName) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  /**
   * Get a single document by ID
   */
  const getDocument = async (docId) => {
    try {
      setLoading(true);
      setError(null);
      const docRef = doc(db, collectionName, docId);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        return { data: { id: docSnap.id, ...docSnap.data() }, error: null };
      } else {
        return { data: null, error: "Document not found" };
      }
    } catch (err) {
      setError(err.message);
      return { data: null, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Get all documents in collection
   */
  const getAllDocuments = async () => {
    try {
      setLoading(true);
      setError(null);
      const querySnapshot = await getDocs(collection(db, collectionName));
      const documents = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      return { data: documents, error: null };
    } catch (err) {
      setError(err.message);
      return { data: null, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Query documents with filters
   * Example: queryDocuments([where("age", ">", 18), orderBy("name"), limit(10)])
   */
  const queryDocuments = async (queryConstraints = []) => {
    try {
      setLoading(true);
      setError(null);
      const q = query(collection(db, collectionName), ...queryConstraints);
      const querySnapshot = await getDocs(q);
      const documents = querySnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      return { data: documents, error: null };
    } catch (err) {
      setError(err.message);
      return { data: null, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Add a new document with auto-generated ID
   */
  const addDocument = async (data) => {
    try {
      setLoading(true);
      setError(null);
      const docRef = await addDoc(collection(db, collectionName), {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      return { id: docRef.id, error: null };
    } catch (err) {
      setError(err.message);
      return { id: null, error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Set a document with specific ID (create or overwrite)
   */
  const setDocument = async (docId, data) => {
    try {
      setLoading(true);
      setError(null);
      await setDoc(doc(db, collectionName, docId), {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      return { error: null };
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Update an existing document
   */
  const updateDocument = async (docId, data) => {
    try {
      setLoading(true);
      setError(null);
      const docRef = doc(db, collectionName, docId);
      await updateDoc(docRef, {
        ...data,
        updatedAt: new Date().toISOString(),
      });
      return { error: null };
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    } finally {
      setLoading(false);
    }
  };

  /**
   * Delete a document
   */
  const deleteDocument = async (docId) => {
    try {
      setLoading(true);
      setError(null);
      await deleteDoc(doc(db, collectionName, docId));
      return { error: null };
    } catch (err) {
      setError(err.message);
      return { error: err.message };
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    error,
    getDocument,
    getAllDocuments,
    queryDocuments,
    addDocument,
    setDocument,
    updateDocument,
    deleteDocument,
  };
}

