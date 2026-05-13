import { initializeApp, getApps, cert, type ServiceAccount } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

let _db: Firestore | null = null;

export function getDb(): Firestore {
  if (_db) return _db;

  if (getApps().length === 0) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) {
      throw new Error(
        `Firebase credentials missing (projectId=${!!projectId}, clientEmail=${!!clientEmail}, privateKey=${!!privateKey})`,
      );
    }

    let cleanKey = privateKey.trim();
    if (
      (cleanKey.startsWith('"') && cleanKey.endsWith('"')) ||
      (cleanKey.startsWith("'") && cleanKey.endsWith("'"))
    ) {
      cleanKey = cleanKey.slice(1, -1);
    }
    cleanKey = cleanKey.replace(/\\n/g, "\n");

    const serviceAccount: ServiceAccount = { projectId, clientEmail, privateKey: cleanKey };
    initializeApp({ credential: cert(serviceAccount) });
  }

  const databaseId = process.env.FIREBASE_DATABASE_ID;
  _db = databaseId ? getFirestore(databaseId) : getFirestore();
  _db.settings({ preferRest: true });

  return _db;
}
