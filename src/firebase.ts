import { getApp, getApps, initializeApp, type FirebaseOptions } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

const masterDataConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_MASTERDATA_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_MASTERDATA_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_MASTERDATA_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_MASTERDATA_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MASTERDATA_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_MASTERDATA_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_MASTERDATA_FIREBASE_MEASUREMENT_ID,
};

const hasMasterDataConfig = [
  masterDataConfig.apiKey,
  masterDataConfig.authDomain,
  masterDataConfig.projectId,
  masterDataConfig.storageBucket,
  masterDataConfig.messagingSenderId,
  masterDataConfig.appId,
].every((value) => typeof value === 'string' && value.trim().length > 0);

const masterDataApp = hasMasterDataConfig
  ? getApps().find((firebaseApp) => firebaseApp.name === 'master-data') ??
    initializeApp(masterDataConfig, 'master-data')
  : null;

export const masterDataDb = masterDataApp
  ? getFirestore(masterDataApp)
  : null;

export const masterDataProjectsPath =
  import.meta.env.VITE_MASTERDATA_PROJECTS_PATH?.trim() ?? '';

const maintShopConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_MAINTSHOP_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_MAINTSHOP_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_MAINTSHOP_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_MAINTSHOP_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_MAINTSHOP_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_MAINTSHOP_FIREBASE_APP_ID,
};

const hasMaintShopConfig = [
  maintShopConfig.apiKey,
  maintShopConfig.authDomain,
  maintShopConfig.projectId,
  maintShopConfig.storageBucket,
  maintShopConfig.messagingSenderId,
  maintShopConfig.appId,
].every((value) => typeof value === 'string' && value.trim().length > 0);

const maintShopApp = hasMaintShopConfig
  ? getApps().find((firebaseApp) => firebaseApp.name === 'maint-shop') ??
    initializeApp(maintShopConfig, 'maint-shop')
  : null;

export const maintShopDb = maintShopApp
  ? getFirestore(maintShopApp)
  : null;
