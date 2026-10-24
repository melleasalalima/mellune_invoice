/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  getDoc,
  getDocFromCache,
  getDocs,
  getDocsFromCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type DocumentReference,
  type Query,
} from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Keep a bounded IndexedDB cache for offline use and reuse across app sessions.
const firestoreSettings = {
  experimentalAutoDetectLongPolling: true,
  localCache: persistentLocalCache({
    cacheSizeBytes: 100 * 1024 * 1024,
    tabManager: persistentMultipleTabManager(),
  }),
};

// Initialize Firestore with cache settings
const firestoreDatabaseId = "firestoreDatabaseId" in firebaseConfig
  && typeof firebaseConfig.firestoreDatabaseId === "string"
  ? firebaseConfig.firestoreDatabaseId
  : undefined;

export const db = initializeFirestore(
  app,
  firestoreSettings,
  firestoreDatabaseId
);

export const auth = getAuth();

export async function getDocCacheFirst<T>(reference: DocumentReference<T>) {
  try {
    return await getDocFromCache(reference);
  } catch {
    return getDoc(reference);
  }
}

export async function getDocsCacheFirst<T>(reference: Query<T>) {
  try {
    const cached = await getDocsFromCache(reference);
    if (!cached.empty) return cached;
  } catch {
    // A first visit has no local copy yet; fetch it once from the server.
  }
  return getDocs(reference);
}

// --- FIRESTORE SECURE ERROR HANDLER ---
export enum OperationType {
  CREATE = "create",
  UPDATE = "update",
  DELETE = "delete",
  LIST = "list",
  GET = "get",
  WRITE = "write",
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errMsg = error instanceof Error ? error.message : String(error);
  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid || null,
      email: auth.currentUser?.email || null,
      emailVerified: auth.currentUser?.emailVerified || null,
      isAnonymous: auth.currentUser?.isAnonymous || null,
      tenantId: auth.currentUser?.tenantId || null,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || [],
    },
    operationType,
    path,
  };
  
  console.error("Firestore Error: ", JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
