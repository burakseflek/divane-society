import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEvent } from 'expo';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { StatusBar } from 'expo-status-bar';
import * as TaskManager from 'expo-task-manager';
import { useVideoPlayer, VideoView } from 'expo-video';
import { createContext, memo, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeModules,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  StatusBar as RNStatusBar,
  Text,
  TextInput,
  useColorScheme,
  View,
} from 'react-native';

const QRCode = require('qrcode-terminal/vendor/QRCode');
const QRErrorCorrectLevel = require('qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel');

const SESSION_KEY = 'divane_society_session_v2';
const DATA_KEY = 'divane_society_live_data_v1';
const NOTIFICATION_PLAN_KEY = 'divane_society_notification_plan_v1';
const DIVANE_GEOFENCE_TASK = 'divane-society-geofence-reminder';
const NOTIFICATION_CHANNEL_ID = 'divane-society';
const STORY_DURATION_MS = 20000;
const venueLogos = {
  lounge: require('./assets/divane-lounge-logo.png'),
  mey: require('./assets/divane-mey-logo.png'),
  barney: require('./assets/barney-pub-logo.png'),
};
const societyIcon = require('./assets/divane-society-icon.png');

const BLUE = '#9FC9F3';
const SAFE_TOP = Platform.OS === 'ios' ? 54 : RNStatusBar.currentHeight || 24;
const SAFE_BOTTOM = Platform.OS === 'ios' ? 34 : 16;
const ROOT_TOP_PADDING = Platform.OS === 'android' ? SAFE_TOP : 0;
const ThemeContext = createContext(false);
const useDarkMode = () => useContext(ThemeContext);
const copy = {
  loginTitle: 'Giriş Yap',
  signupTitle: 'Üye Ol',
  identifier: 'Telefon numarası veya kullanıcı ID',
  password: 'Şifre',
  remember: 'Beni hatırla',
  login: 'Giriş Yap',
  signup: 'Üye Ol',
  fullName: 'Ad Soyad',
  email: 'E-posta',
};

const venues = [
  { id: 'all', name: 'Tümü', short: 'All', accent: '#1F2937' },
  { id: 'lounge', name: 'Divane Lounge', short: 'Lounge', accent: '#7CB7F0' },
  { id: 'mey', name: 'Divane Mey', short: 'Mey', accent: '#F0A6BA' },
  { id: 'barney', name: 'Barney Pub', short: 'Pub', accent: '#89D8C2' },
];

const divaneGeoRegions = [
  { identifier: 'Divane Lounge', latitude: 37.8746, longitude: 32.4932, radius: 180, notifyOnEnter: true, notifyOnExit: false },
  { identifier: 'Divane Mey', latitude: 37.8749, longitude: 32.4944, radius: 180, notifyOnEnter: true, notifyOnExit: false },
  { identifier: 'Barney Pub', latitude: 37.8752, longitude: 32.4921, radius: 180, notifyOnEnter: true, notifyOnExit: false },
];

const venueNameFromId = (id) => venues.find((venue) => venue.id === id)?.name || 'Divane Lounge';
const venueIdFromName = (name = '') => venues.find((venue) => venue.name === name || venue.id === name)?.id || 'lounge';
const isVenueScopedRole = (role) => role === 'Mekan Admini' || role === 'Personel';
const rewardTitle = (reward) => (typeof reward === 'string' ? reward : reward?.title || 'Society ödülü');
const rewardCode = (reward) => (typeof reward === 'string' ? reward : reward?.id || reward?.title);
const makeId = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

if (!TaskManager.isTaskDefined(DIVANE_GEOFENCE_TASK)) {
  TaskManager.defineTask(DIVANE_GEOFENCE_TASK, async ({ data, error }) => {
    if (error || data?.eventType !== Location.GeofencingEventType.Enter) return;
    const venueName = data?.region?.identifier || 'Divane Society';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `${venueName} yakınındasın`,
        body: 'QR katılımını aç, girişini onaylat ve çark hakkına yaklaş.',
        data: { screen: 'QR Katılım', venue: venueName, type: 'geofence-checkin' },
      },
      trigger: null,
    });
  });
}

const societyDateKey = (dateValue = new Date()) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const normalizeMemberRecord = (record = {}) => {
  const checkIns = Number.isFinite(Number(record.checkIns)) ? Number(record.checkIns) : 0;
  const spinRewards = Array.isArray(record.spinRewards) ? record.spinRewards : [];
  const derivedCredits = Math.max(0, Math.floor(checkIns / 5) - spinRewards.length);
  return {
    ...record,
    checkIns,
    monthlyCheckIns: Number.isFinite(Number(record.monthlyCheckIns)) ? Math.max(0, Number(record.monthlyCheckIns)) : undefined,
    checkInProgress: Number.isFinite(Number(record.checkInProgress)) ? Number(record.checkInProgress) : checkIns % 5,
    spinCredits: Number.isFinite(Number(record.spinCredits)) ? Math.max(0, Number(record.spinCredits)) : Math.min(1, derivedCredits),
    spinRewards,
    rewardUses: Array.isArray(record.rewardUses) ? record.rewardUses : [],
    checkInLog: Array.isArray(record.checkInLog) ? record.checkInLog : [],
    checkInCodes: Array.isArray(record.checkInCodes) ? record.checkInCodes : [],
  };
};
const normalizeComment = (comment, fallbackAuthor) => {
  if (typeof comment === 'object' && comment) {
    return { author: comment.author || fallbackAuthor, text: comment.text || '' };
  }
  const text = String(comment || '');
  const splitIndex = text.indexOf(': ');
  if (splitIndex > 0 && splitIndex < 32) {
    return { author: text.slice(0, splitIndex), text: text.slice(splitIndex + 2) };
  }
  return { author: '', text };
};
const formatSocietyTime = (dateValue) => {
  const date = dateValue ? new Date(dateValue) : new Date();
  if (Number.isNaN(date.getTime())) return 'Şimdi';
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
};
const parseBirthDate = (value = '') => {
  const raw = String(value).trim();
  const match = raw.match(/^(\d{2})[./-](\d{2})[./-](\d{4})$/);
  if (!match) return null;
  const [, day, month, year] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) return null;
  return date;
};
const formatBirthDate = (date) => `${String(date.getDate()).padStart(2, '0')}.${String(date.getMonth() + 1).padStart(2, '0')}.${date.getFullYear()}`;
const calculateAge = (birthDate, now = new Date()) => {
  let age = now.getFullYear() - birthDate.getFullYear();
  const monthDiff = now.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birthDate.getDate())) age -= 1;
  return age;
};
const isBirthdayToday = (birthDateValue, now = new Date()) => {
  const birthDate = parseBirthDate(birthDateValue);
  return Boolean(birthDate && birthDate.getDate() === now.getDate() && birthDate.getMonth() === now.getMonth());
};
const currentYear = () => new Date().getFullYear();
const monthlyCheckInCount = (record = {}) => {
  const now = new Date();
  const monthlyLog = (record.checkInLog || []).filter((entry) => {
    const date = new Date(entry.at);
    return !Number.isNaN(date.getTime()) && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear();
  });
  if (monthlyLog.length) return monthlyLog.length;
  if (Number.isFinite(Number(record.monthlyCheckIns))) return Number(record.monthlyCheckIns);
  return Math.min(Number(record.checkIns) || 0, 30);
};
const loyaltyTierFromMonthly = (monthlyCount = 0) => {
  if (monthlyCount >= 15) return 'Gold Sadakat';
  if (monthlyCount >= 6) return 'Bronz Sadakat';
  return 'Silver Sadakat';
};
const nextTierText = (monthlyCount = 0) => {
  if (monthlyCount >= 15) return 'Gold seviyedesin';
  if (monthlyCount >= 6) return `${15 - monthlyCount} katılım sonra Gold`;
  return `${6 - monthlyCount} katılım sonra Bronz`;
};

const demoCustomer = {
  firstName: 'Ada',
  lastName: 'Demir',
  phone: '5551112233',
  password: '1234',
  email: 'ada@divanesociety.app',
  birthDate: '21.05.1995',
  verifiedAt: '2026-05-21T21:18:00.000Z',
  verificationMethod: 'Telefon',
  photo: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=300&auto=format&fit=crop',
  tier: 'Silver Sadakat',
  favoriteVenue: 'Divane Lounge',
};

const rewardOptions = ['+1 Kokteyl', 'Shot İkramı', '%20 İndirim', 'VIP Rezervasyon', 'Ücretsiz Giriş', 'Masa İkramı'];

const defaultMemberStats = {
  [demoCustomer.phone]: { checkIns: 4, monthlyCheckIns: 4, checkInProgress: 4, spinCredits: 0, spinRewards: [], rewardUses: [], checkInLog: [], checkInCodes: [] },
};

const defaultCampaigns = ['5 Katılım 1 Çark', 'Gold Member VIP Fast Entry', 'Barney Pub Çift Puan'];

const defaultReservations = [
  { id: 'RZ-4821', venue: 'Divane Lounge', date: '24 Mayıs', time: '22.30', area: 'VIP', people: 4, status: 'Onaylandı', customer: 'Ada Demir', phone: demoCustomer.phone },
  { id: 'RZ-4808', venue: 'Divane Mey', date: '18 Mayıs', time: '20.00', area: 'Bahçe', people: 6, status: 'Geldi', customer: 'Ada Demir', phone: demoCustomer.phone },
  { id: 'RZ-4772', venue: 'Barney Pub', date: '12 Mayıs', time: '21.15', area: 'Bar Önü', people: 3, status: 'İptal', customer: 'Ada Demir', phone: demoCustomer.phone },
  { id: 'RZ-4866', venue: 'Divane Lounge', date: '26 Mayıs', time: '23.00', area: 'Ana Salon', people: 2, status: 'Beklemede', customer: 'Ada Demir', phone: demoCustomer.phone },
];

const defaultRequests = [
  { id: 'SI-901', category: 'Doğum Günü Talebi', venue: 'Divane Mey', title: 'Tatlı servisi', status: 'Yeni', text: 'Masa için mumlu tatlı ve kısa anons istendi.', customer: 'Ada Demir', phone: demoCustomer.phone },
  { id: 'SI-902', category: 'VIP Talebi', venue: 'Divane Lounge', title: 'Booth upgrade', status: 'Yanıtlandı', text: 'Cumartesi için VIP booth uygunluğu iletildi.', customer: 'Ada Demir', phone: demoCustomer.phone },
  { id: 'SI-903', category: 'Öneri', venue: 'Barney Pub', title: 'Craft tadım', status: 'İnceleniyor', text: 'Haftalık craft tasting önerisi alındı.', customer: 'Ada Demir', phone: demoCustomer.phone },
];

const staffAccounts = [
  { id: 'SA-001', password: '1234', role: 'Super Admin', venue: 'Tüm Mekanlar', name: 'Deniz Arslan' },
  { id: 'ADM-101', password: '1234', role: 'Mekan Admini', venue: 'Divane Lounge', name: 'Ece Yaman' },
  { id: 'PRS-210', password: '1234', role: 'Personel', venue: 'Barney Pub', name: 'Mert Kaya' },
];

const defaultLiveData = {
  customers: [demoCustomer],
  staffAccounts,
  appPosts: [],
  appStories: [],
  appRewards: rewardOptions,
  appCampaigns: defaultCampaigns,
  reservations: defaultReservations,
  requests: defaultRequests,
  notifications: [
    { id: 'NT-100', type: 'system', title: 'Bildirim Merkezi Hazır', text: 'Story, gönderi, rezervasyon ve istek hareketleri burada toplanır.', target: 'admin', createdAt: 'Bugün' },
  ],
  customerMessages: [],
  memberStats: defaultMemberStats,
};

const getApiBaseUrl = () => {
  const envUrl = typeof process !== 'undefined' ? process.env?.EXPO_PUBLIC_API_URL : undefined;
  if (envUrl) return envUrl.replace(/\/$/, '');
  const scriptUrl = NativeModules?.SourceCode?.scriptURL;
  const nativeHost = scriptUrl?.match(/^https?:\/\/([^:/]+)/)?.[1];
  if (nativeHost) return `http://${nativeHost}:4000`;
  const webHost = typeof window !== 'undefined' ? window.location?.hostname : null;
  return `http://${webHost || '127.0.0.1'}:4000`;
};

const API_BASE_URL = getApiBaseUrl();

const normalizeLiveData = (data = {}) => {
  const customers = data.customers?.length ? data.customers : defaultLiveData.customers;
  const customerNameByPhone = customers.reduce((acc, customer) => ({
    ...acc,
    [customer.phone]: `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || customer.name || 'Müşteri',
  }), {});
  const rawMemberStats = { ...defaultMemberStats, ...(data.memberStats || {}) };
  const memberStats = Object.entries(rawMemberStats).reduce((acc, [phone, record]) => ({
    ...acc,
    [phone]: normalizeMemberRecord(record),
  }), {});
  const withCustomerName = (item) => ({
    ...item,
    customer: item.customer || customerNameByPhone[item.phone] || `${demoCustomer.firstName} ${demoCustomer.lastName}`,
    phone: item.phone || demoCustomer.phone,
  });
  const isPublishableMedia = (media) => {
    if (!media) return false;
    if (typeof media === 'string') return !media.startsWith('file:');
    const uri = media.remoteUri || media.uri || '';
    return Boolean(uri) && !media.localOnly && !String(uri).startsWith('file:');
  };
  const cleanPublications = (items = []) => items.filter((item) => isPublishableMedia(item.image));
  return {
    customers,
    staffAccounts: data.staffAccounts?.length ? data.staffAccounts : staffAccounts,
    appPosts: Array.isArray(data.appPosts) ? cleanPublications(data.appPosts) : [],
    appStories: Array.isArray(data.appStories) ? cleanPublications(data.appStories) : [],
    appRewards: data.appRewards?.length ? data.appRewards : rewardOptions,
    appCampaigns: data.appCampaigns?.length ? data.appCampaigns : defaultCampaigns,
    reservations: (data.reservations?.length ? data.reservations : defaultReservations).map(withCustomerName),
    requests: (data.requests?.length ? data.requests : defaultRequests).map(withCustomerName),
    notifications: Array.isArray(data.notifications) ? data.notifications : defaultLiveData.notifications,
    customerMessages: Array.isArray(data.customerMessages) ? data.customerMessages : [],
    memberStats,
  };
};

const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    throw new Error(`API ${response.status}`);
  }
  return response.json();
};

const uploadMediaWithXhr = (media) => new Promise((resolve, reject) => {
  const body = new FormData();
  const fileName = media.fileName || `divane-media-${Date.now()}.${media.type === 'video' ? 'mp4' : 'jpg'}`;
  const mimeType = media.mimeType || (media.type === 'video' ? 'video/mp4' : 'image/jpeg');
  body.append('mediaType', media.type || 'image');
  body.append('fileName', fileName);
  body.append('file', {
    uri: media.localUri || media.uri,
    name: fileName,
    type: mimeType,
  });
  const xhr = new XMLHttpRequest();
  xhr.timeout = 180000;
  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      try {
        resolve(JSON.parse(xhr.responseText));
      } catch (error) {
        reject(new Error('Upload cevabı okunamadı.'));
      }
      return;
    }
    reject(new Error(`Upload API ${xhr.status}: ${xhr.responseText || 'cevap yok'}`));
  };
  xhr.onerror = () => reject(new Error(`Video servisine erişilemiyor: ${API_BASE_URL}`));
  xhr.ontimeout = () => reject(new Error('Video yükleme zaman aşımına uğradı.'));
  xhr.open('POST', `${API_BASE_URL}/api/upload`);
  xhr.send(body);
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const stories = [
  { id: 1, venue: 'lounge', title: 'Afro House Night', label: 'Divane Lounge', time: '05:42 kaldı', likes: 184, image: 'https://images.unsplash.com/photo-1571266028243-3716f02d6597?w=900&auto=format&fit=crop', comments: ['VIP masa atmosferi müthiş.', 'Saat 23.00 setini kaçırmayın.'] },
  { id: 2, venue: 'lounge', title: 'Blue Booth Setup', label: 'Divane Lounge', time: '06:10 kaldı', likes: 129, image: 'https://images.unsplash.com/photo-1566737236500-c8ac43014a8e?w=900&auto=format&fit=crop', comments: ['Masa ışıkları çok iyi.', 'Booth rezervasyonu açıldı mı?'] },
  { id: 3, venue: 'mey', title: 'Rakı & Meze Gecesi', label: 'Divane Mey', time: '07:18 kaldı', likes: 142, image: 'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=900&auto=format&fit=crop', comments: ['Yeni meze tabağı çok iyi.', 'Fasıl sonrası rezervasyon yaptık.'] },
  { id: 4, venue: 'mey', title: 'Bahçe Masaları', label: 'Divane Mey', time: '08:12 kaldı', likes: 96, image: 'https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=900&auto=format&fit=crop', comments: ['Bahçede yer ayırdık.', 'Meze menüsünü bekliyoruz.'] },
  { id: 5, venue: 'barney', title: 'Live Match Night', label: 'Barney Pub', time: '09:06 kaldı', likes: 219, image: 'https://images.unsplash.com/photo-1572116469696-31de0f17cc34?w=900&auto=format&fit=crop', comments: ['Derbi için ekranlar hazır.', 'Craft seçki favorim.'] },
  { id: 6, venue: 'barney', title: 'After Match DJ', label: 'Barney Pub', time: '10:22 kaldı', likes: 153, image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=900&auto=format&fit=crop', comments: ['Maç sonrası kalıyoruz.', 'Bar önü iyi.'] },
];

const posts = [
  { id: 1, venue: 'lounge', venueName: 'Divane Lounge', date: 'Bu gece 22.30', title: 'Afro House Night', cta: 'Rezervasyon Yap', likes: 428, comments: ['DJ Lina seti bekleniyor.', 'Lounge ışıklar şahane.'], image: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=1000&auto=format&fit=crop', description: 'Soft blue light, premium booth ve imza kokteyllerle hafta sonu açılışı.' },
  { id: 2, venue: 'mey', venueName: 'Divane Mey', date: 'Yarın 20.00', title: 'Rakı & Meze Tasting', cta: 'Masa Seç', likes: 316, comments: ['Deniz börülcesi favori.', 'Bahçe alanı açıldı mı?'], image: 'https://images.unsplash.com/photo-1544025162-d76694265947?w=1000&auto=format&fit=crop', description: 'Şefin yeni meze seçkisi, soğuk servis ritüeli ve uzun masa deneyimi.' },
  { id: 3, venue: 'barney', venueName: 'Barney Pub', date: 'Cumartesi 21.00', title: 'Live Match Night', cta: 'Katılım Al', likes: 512, comments: ['Bar önü iyi fikir.', 'Maç sonrası DJ var mı?'], image: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=1000&auto=format&fit=crop', description: 'Dev ekran, craft bira eşleşmeleri ve sadakat kartına çift puan.' },
  { id: 4, venue: 'all', venueName: 'Divane Society', date: 'Bu hafta', title: '5 Katılım 1 Çark', cta: 'QR Aç', likes: 674, comments: ['4/5 tamamlandı.', 'Kokteyl hediyesi gelsin.'], image: 'https://images.unsplash.com/photo-1527529482837-4698179dc6ce?w=1000&auto=format&fit=crop', description: 'Beşinci check-in sonrası otomatik çark hakkı ve premium hediye QR.' },
];

const checkIns = [
  { venue: 'Divane Lounge', date: 'Dün 23.18', points: '+85 puan' },
  { venue: 'Barney Pub', date: 'Pazar 21.06', points: '+60 puan' },
  { venue: 'Divane Mey', date: 'Cuma 20.44', points: '+75 puan' },
];

const reservations = defaultReservations;

const requests = defaultRequests;

const wheelPrizeAngles = [30, 90, 150, 210, 270, 330];
const makeWheelPosition = (angle, radius, width, height) => {
  const radian = (angle * Math.PI) / 180;
  const center = 138;
  return {
    left: center + Math.sin(radian) * radius - width / 2,
    top: center - Math.cos(radian) * radius - height / 2,
    width,
    minHeight: height,
  };
};
const wheelSlotStyles = wheelPrizeAngles.map((angle) => makeWheelPosition(angle, 83, 92, 52));
const wheelSegmentStyles = wheelPrizeAngles.map((angle) => makeWheelPosition(angle, 84, 116, 70));

const staffScans = [
  { name: 'Ada Demir', phone: demoCustomer.phone, reward: '+1 Kokteyl', status: 'Kullanılabilir', venue: 'Divane Lounge' },
  { name: 'Bora Şen', reward: '%20 İndirim', status: 'Kullanıldı', venue: 'Divane Mey' },
  { name: 'Selin Ak', reward: 'VIP Rezervasyon', status: 'Süresi Doldu', venue: 'Barney Pub' },
];

const initialUsers = [
  { id: 1, name: 'Ada Demir', phone: '5551112233', tier: 'Gold', visits: 24 },
  { id: 2, name: 'Bora Şen', phone: '5552223344', tier: 'Silver', visits: 11 },
  { id: 3, name: 'Selin Ak', phone: '5553334455', tier: 'Platinum', visits: 38 },
];

const customerTabs = ['Ana Sayfa', 'QR Katılım', 'Çark', 'Sadakat', 'Rezervasyon', 'İstek', 'Profil'];
const staffTabs = ['Dashboard', 'QR Tara', 'Rezervasyonlar'];
const adminTabs = ['Dashboard', 'Kullanıcılar', 'Mekanlar', 'Story', 'Gönderiler', 'Rezervasyonlar', 'Çark', 'Kampanyalar', 'İstekler', 'Personel', 'Analytics'];
const tabIcons = {
  'Ana Sayfa': '⌂',
  'QR Katılım': '▣',
  Çark: '◌',
  Sadakat: '★',
  Rezervasyon: '◷',
  İstek: '✎',
  Profil: '●',
  Dashboard: '⌁',
  'QR Tara': '▣',
  'Hediye QR': '◇',
  Rezervasyonlar: '◷',
  'Müşteri Kartı': '●',
  Kullanıcılar: '●',
  Mekanlar: '⌂',
  Story: '+',
  Gönderiler: '□',
  Kampanyalar: '★',
  Personel: '●',
  Analytics: '≋',
};

export default function App() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState([demoCustomer]);
  const [liveStaffAccounts, setLiveStaffAccounts] = useState(staffAccounts);
  const [appPosts, setAppPosts] = useState([]);
  const [appStories, setAppStories] = useState([]);
  const [appRewards, setAppRewards] = useState(rewardOptions);
  const [appCampaigns, setAppCampaigns] = useState(['5 Katılım 1 Çark', 'Gold Member VIP Fast Entry', 'Barney Pub Çift Puan']);
  const [liveReservations, setLiveReservations] = useState(defaultReservations);
  const [liveRequests, setLiveRequests] = useState(defaultRequests);
  const [notifications, setNotifications] = useState(defaultLiveData.notifications);
  const [customerMessages, setCustomerMessages] = useState([]);
  const [memberStats, setMemberStats] = useState(defaultMemberStats);
  const [bannerNotification, setBannerNotification] = useState(null);
  const liveDataRef = useRef(defaultLiveData);
  const bannerTimerRef = useRef(null);
  const registeredNotificationSessionRef = useRef('');
  const lastSpinCreditNotificationRef = useRef({});

  const applyLiveData = (rawData) => {
    const data = normalizeLiveData(rawData);
    liveDataRef.current = data;
    setCustomers(data.customers);
    setLiveStaffAccounts(data.staffAccounts);
    setAppPosts(data.appPosts);
    setAppStories(data.appStories);
    setAppRewards(data.appRewards);
    setAppCampaigns(data.appCampaigns);
    setLiveReservations(data.reservations);
    setLiveRequests(data.requests);
    setNotifications(data.notifications);
    setCustomerMessages(data.customerMessages);
    setMemberStats(data.memberStats);
    return data;
  };

  const currentLiveData = (overrides = {}) => normalizeLiveData({
    ...liveDataRef.current,
    ...overrides,
  });

  const persistRemote = async (nextData) => {
    await AsyncStorage.setItem(DATA_KEY, JSON.stringify(nextData));
    try {
      const remote = await apiRequest('/api/state', {
        method: 'POST',
        body: JSON.stringify(nextData),
      });
      const normalized = applyLiveData(remote);
      await AsyncStorage.setItem(DATA_KEY, JSON.stringify(normalized));
    } catch (error) {
      console.log('Divane Society demo backend offline, local cache kept.', error.message);
    }
  };

  const commitLiveData = (patch) => {
    const nextData = currentLiveData(patch);
    applyLiveData(nextData);
    persistRemote(nextData);
  };

  const updateCustomers = (updater) => {
    setCustomers((current) => {
      const nextCustomers = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ customers: nextCustomers });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextCustomers;
    });
  };

  const updateStaffAccounts = (updater) => {
    setLiveStaffAccounts((current) => {
      const nextStaffAccounts = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ staffAccounts: nextStaffAccounts });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextStaffAccounts;
    });
  };

  const updateAppPosts = (updater) => {
    setAppPosts((current) => {
      const nextPosts = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ appPosts: nextPosts });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextPosts;
    });
  };

  const updateAppStories = (updater) => {
    setAppStories((current) => {
      const nextStories = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ appStories: nextStories });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextStories;
    });
  };

  const updateAppRewards = (updater) => {
    setAppRewards((current) => {
      const nextRewards = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ appRewards: nextRewards });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextRewards;
    });
  };

  const updateAppCampaigns = (updater) => {
    setAppCampaigns((current) => {
      const nextCampaigns = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ appCampaigns: nextCampaigns });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextCampaigns;
    });
  };

  const updateReservations = (updater) => {
    setLiveReservations((current) => {
      const nextReservations = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ reservations: nextReservations });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextReservations;
    });
  };

  const updateRequests = (updater) => {
    setLiveRequests((current) => {
      const nextRequests = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ requests: nextRequests });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextRequests;
    });
  };

  const updateNotifications = (updater) => {
    setNotifications((current) => {
      const nextNotifications = typeof updater === 'function' ? updater(current) : updater;
      const freshNotifications = nextNotifications.filter((item) => !current.some((existing) => existing.id === item.id));
      freshNotifications.forEach((notification) => {
        if (notification.target === 'admin') {
          deliverPhoneNotification({
            audience: 'admins',
            title: notification.title || 'Divane Society',
            body: notification.text || 'Yeni yönetim bildirimi var.',
            data: { type: notification.type || 'admin-event' },
          });
        }
      });
      const nextData = currentLiveData({ notifications: nextNotifications });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextNotifications;
    });
  };

  const updateCustomerMessages = (updater) => {
    setCustomerMessages((current) => {
      const nextMessages = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ customerMessages: nextMessages });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextMessages;
    });
  };

  const updateMemberStats = (updater) => {
    setMemberStats((current) => {
      const nextStats = typeof updater === 'function' ? updater(current) : updater;
      const nextData = currentLiveData({ memberStats: nextStats });
      liveDataRef.current = nextData;
      persistRemote(nextData);
      return nextStats;
    });
  };

  useEffect(() => {
    const boot = async () => {
      const [sessionRaw, dataRaw] = await Promise.all([AsyncStorage.getItem(SESSION_KEY), AsyncStorage.getItem(DATA_KEY)]);
      if (sessionRaw) setSession(JSON.parse(sessionRaw));
      try {
        const remote = await apiRequest('/api/state');
        const normalized = applyLiveData(remote);
        await AsyncStorage.setItem(DATA_KEY, JSON.stringify(normalized));
      } catch (error) {
        if (dataRaw) {
          applyLiveData(JSON.parse(dataRaw));
        } else {
          applyLiveData(defaultLiveData);
        }
      } finally {
        setLoading(false);
      }
    };
    boot();
  }, []);

  useEffect(() => {
    if (loading) return;
    AsyncStorage.setItem(DATA_KEY, JSON.stringify({ customers, staffAccounts: liveStaffAccounts, appPosts, appStories, appRewards, appCampaigns, reservations: liveReservations, requests: liveRequests, notifications, customerMessages, memberStats }));
  }, [loading, customers, liveStaffAccounts, appPosts, appStories, appRewards, appCampaigns, liveReservations, liveRequests, notifications, customerMessages, memberStats]);

  useEffect(() => {
    if (loading || !session) return;
    registerForPushNotifications(session);
    if (session.type === 'customer') {
      const record = memberStats[session.user.phone] || {};
      scheduleCustomerNotificationPlan(session.user, record);
      enableVenueLocationReminders();
    }
  }, [loading, session?.type, session?.user?.phone]);

  useEffect(() => {
    if (loading || session?.type !== 'customer') return;
    const phone = session.user.phone;
    const credits = Number(memberStats[phone]?.spinCredits || 0);
    if (credits <= 0 || lastSpinCreditNotificationRef.current[phone] === credits) return;
    lastSpinCreditNotificationRef.current[phone] = credits;
    deliverPhoneNotification({
      audience: 'phone',
      phone,
      title: 'Çark hakkın hazır',
      body: `${credits} aktif hakkın var. Çarkını çevirip ödül QR kodunu oluşturabilirsin.`,
      data: { type: 'spin-credit', screen: 'Çark' },
    });
  }, [loading, session?.type, session?.user?.phone, memberStats[session?.user?.phone]?.spinCredits]);

  const refreshLiveData = async () => {
    try {
      const remote = await apiRequest('/api/state');
      const normalized = applyLiveData(remote);
      await AsyncStorage.setItem(DATA_KEY, JSON.stringify(normalized));
    } catch (error) {
      const dataRaw = await AsyncStorage.getItem(DATA_KEY);
      if (dataRaw) applyLiveData(JSON.parse(dataRaw));
    }
  };

  const uploadMedia = async (media) => {
    try {
      if (media.localUri) {
        return await uploadMediaWithXhr(media);
      }
      return await apiRequest('/api/upload', {
        method: 'POST',
        body: JSON.stringify(media),
      });
    } catch (error) {
      try {
        if (media.localUri) {
          const dataUri = await assetToDataUri({ ...media, uri: media.localUri });
          if (!String(dataUri).startsWith('data:')) throw new Error('Local media could not be converted');
          return await apiRequest('/api/upload', {
            method: 'POST',
            body: JSON.stringify({ ...media, uri: dataUri, localUri: undefined }),
          });
        }
      } catch (fallbackError) {
        return { uploadFailed: true, error: fallbackError.message || error.message };
      }
      return { uploadFailed: true, error: error.message };
    }
  };

  const schedulePhoneNotification = async ({ title, body, data = {}, seconds, calendar }) => {
    if (Platform.OS === 'web') return null;
    try {
      const trigger = calendar
        ? { type: Notifications.SchedulableTriggerInputTypes.CALENDAR, ...calendar }
        : seconds
          ? { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds }
          : null;
      return await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          data,
          sound: 'default',
        },
        trigger,
      });
    } catch (error) {
      console.log('Notification schedule skipped:', error.message);
      return null;
    }
  };

  const shouldNotifyCurrentDevice = ({ audience, phone }) => {
    if (!session) return false;
    if (audience === 'all') return true;
    if (audience === 'customers') return session.type === 'customer';
    if (audience === 'admins') return session.type === 'admin';
    if (audience === 'phone') return session.user?.phone === phone;
    return false;
  };

  const deliverPhoneNotification = async ({ audience = 'all', phone, title, body, data = {} }) => {
    const message = { title, text: body };
    if (shouldNotifyCurrentDevice({ audience, phone })) {
      showInAppNotification(message);
      await schedulePhoneNotification({ title, body, data, seconds: 1 });
    }
    try {
      await apiRequest('/api/push/send', {
        method: 'POST',
        body: JSON.stringify({ audience, phone, title, body, data }),
      });
    } catch (error) {
      console.log('Remote push queue offline:', error.message);
    }
  };

  const registerForPushNotifications = async (activeSession) => {
    if (!activeSession || Platform.OS === 'web') return null;
    const sessionKey = `${activeSession.type}:${activeSession.user?.phone || activeSession.user?.id}`;
    if (registeredNotificationSessionRef.current === sessionKey) return null;
    try {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, {
          name: 'Divane Society',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: BLUE,
        });
      }
      const existingPermission = await Notifications.getPermissionsAsync();
      let finalStatus = existingPermission.status;
      if (finalStatus !== 'granted') {
        const requestedPermission = await Notifications.requestPermissionsAsync();
        finalStatus = requestedPermission.status;
      }
      if (finalStatus !== 'granted') return null;
      const token = (await Notifications.getExpoPushTokenAsync()).data;
      registeredNotificationSessionRef.current = sessionKey;
      await apiRequest('/api/push-token', {
        method: 'POST',
        body: JSON.stringify({
          token,
          platform: Platform.OS,
          audience: activeSession.type === 'customer' ? 'customers' : activeSession.type === 'admin' ? 'admins' : 'staff',
          phone: activeSession.user?.phone,
          staffId: activeSession.user?.id,
          name: activeSession.user?.firstName ? `${activeSession.user.firstName} ${activeSession.user.lastName}` : activeSession.user?.name,
          role: activeSession.role,
        }),
      });
      return token;
    } catch (error) {
      console.log('Push registration skipped:', error.message);
      return null;
    }
  };

  const scheduleCustomerNotificationPlan = async (customer, record = {}) => {
    if (!customer?.phone || Platform.OS === 'web') return;
    const planKey = `${NOTIFICATION_PLAN_KEY}:${customer.phone}`;
    const planVersion = `${currentYear()}-${customer.phone}`;
    const alreadyScheduled = await AsyncStorage.getItem(planKey);
    if (alreadyScheduled === planVersion) return;
    await schedulePhoneNotification({
      title: 'Bu gece Divane Society',
      body: 'Storyleri, kampanyaları ve QR katılımını kaçırma.',
      data: { screen: 'Ana Sayfa', type: 'daily-society' },
      calendar: { hour: 20, minute: 30, repeats: true },
    });
    const normalized = normalizeMemberRecord(record);
    if ((normalized.spinCredits || 0) > 0) {
      await schedulePhoneNotification({
        title: 'Çark hakkın hazır',
        body: 'Hakkını kullan, ödül QR kodunu oluştur.',
        data: { screen: 'Çark', type: 'spin-credit' },
        seconds: 6,
      });
    }
    const lastVisit = normalized.checkInLog?.[0]?.at ? new Date(normalized.checkInLog[0].at) : null;
    const daysSinceVisit = lastVisit && !Number.isNaN(lastVisit.getTime()) ? Math.floor((Date.now() - lastVisit.getTime()) / 86400000) : 30;
    if (daysSinceVisit >= 10) {
      await schedulePhoneNotification({
        title: 'Divane seni özledi',
        body: 'Uzun zamandır giriş yapmadın. Bu hafta QR katılımını açıp çark hakkına yaklaş.',
        data: { screen: 'QR Katılım', type: 'comeback' },
        calendar: { hour: 18, minute: 15, repeats: true },
      });
    }
    await AsyncStorage.setItem(planKey, planVersion);
  };

  const enableVenueLocationReminders = async () => {
    if (Platform.OS === 'web') return;
    try {
      const taskAvailable = await TaskManager.isAvailableAsync();
      if (!taskAvailable) return;
      const foregroundPermission = await Location.requestForegroundPermissionsAsync();
      if (foregroundPermission.status !== 'granted') return;
      await Location.requestBackgroundPermissionsAsync();
      await Location.startGeofencingAsync(DIVANE_GEOFENCE_TASK, divaneGeoRegions);
    } catch (error) {
      console.log('Geofence reminder skipped:', error.message);
    }
  };

  const sendBroadcast = (text) => {
    const notification = { id: makeId('NT'), type: 'broadcast', title: 'Toplu Bildirim', text, target: 'all', createdAt: 'Şimdi', delivery: 'Uygulama açıkken banner, kapalıyken push kuyruğu' };
    commitLiveData({
      notifications: [notification, ...notifications],
      customerMessages: [{ ...notification, id: makeId('MSG'), phone: 'all' }, ...customerMessages],
    });
    deliverPhoneNotification({
      audience: 'customers',
      title: notification.title,
      body: notification.text,
      data: { type: 'broadcast', screen: 'Ana Sayfa' },
    });
  };

  const sendCustomerMessage = (phone, text) => {
    const customer = customers.find((item) => item.phone === phone);
    const message = {
      id: makeId('MSG'),
      phone,
      title: customer ? `${customer.firstName} ${customer.lastName}` : 'Müşteri Mesajı',
      text,
      createdAt: 'Şimdi',
    };
    const notification = { id: makeId('NT'), type: 'message', title: 'Müşteriye mesaj gönderildi', text: `${phone} · Sadakat panelinde görüntülenir.`, target: 'admin', createdAt: 'Şimdi' };
    commitLiveData({
      notifications: [notification, ...notifications],
      customerMessages: [message, ...customerMessages],
    });
    deliverPhoneNotification({
      audience: 'phone',
      phone,
      title: 'Divane Society mesajın var',
      body: text,
      data: { type: 'customer-message', screen: 'Sadakat' },
    });
  };

  const showInAppNotification = (notification) => {
    if (!notification?.title && !notification?.text) return;
    if (bannerTimerRef.current) clearTimeout(bannerTimerRef.current);
    setBannerNotification(notification);
    bannerTimerRef.current = setTimeout(() => setBannerNotification(null), 4200);
  };

  const awardBirthdaySpinIfNeeded = (customer) => {
    if (!customer?.phone || !isBirthdayToday(customer.birthDate)) return;
    const existing = normalizeMemberRecord(memberStats[customer.phone] || {});
    if (existing.birthdayGiftYear === currentYear()) return;
    const birthdayMessage = {
      id: makeId('MSG'),
      phone: customer.phone,
      title: 'Doğum günü hediyen hazır',
      text: 'Divane Society sana özel 1 çark hakkı tanımladı. Mutlu yıllar.',
      createdAt: 'Şimdi',
      type: 'birthday',
    };
    commitLiveData({
      memberStats: {
        ...memberStats,
        [customer.phone]: {
          ...existing,
          spinCredits: Math.max(0, existing.spinCredits || 0) + 1,
          birthdayGiftYear: currentYear(),
          birthdayGiftAt: new Date().toISOString(),
        },
      },
      customerMessages: [birthdayMessage, ...customerMessages],
      notifications: [{ ...birthdayMessage, id: makeId('NT'), target: 'admin' }, ...notifications],
    });
    showInAppNotification(birthdayMessage);
    deliverPhoneNotification({
      audience: 'phone',
      phone: customer.phone,
      title: birthdayMessage.title,
      body: birthdayMessage.text,
      data: { type: 'birthday-spin', screen: 'Çark' },
    });
  };

  const updateCurrentProfile = async (profilePatch) => {
    if (!session?.user?.phone) return null;
    const updatedUser = {
      ...session.user,
      ...profilePatch,
    };
    const customerName = `${updatedUser.firstName || ''} ${updatedUser.lastName || ''}`.trim() || updatedUser.name || 'Müşteri';
    const data = currentLiveData();
    commitLiveData({
      customers: data.customers.map((customer) => (
        customer.phone === updatedUser.phone ? { ...customer, ...updatedUser } : customer
      )),
      reservations: data.reservations.map((reservation) => (
        reservation.phone === updatedUser.phone ? { ...reservation, customer: customerName } : reservation
      )),
      requests: data.requests.map((request) => (
        request.phone === updatedUser.phone ? { ...request, customer: customerName } : request
      )),
    });
    const nextSession = { ...session, user: updatedUser };
    setSession(nextSession);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
    return updatedUser;
  };

  const signIn = async (nextSession) => {
    if (nextSession?.type === 'customer') awardBirthdaySpinIfNeeded(nextSession.user);
    setSession(nextSession);
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
  };

  useEffect(() => {
    if (!loading && session?.type === 'customer') awardBirthdaySpinIfNeeded(session.user);
  }, [loading, session?.type, session?.user?.phone, session?.user?.birthDate]);

  const signOut = async () => {
    if (Platform.OS !== 'web') {
      Location.stopGeofencingAsync(DIVANE_GEOFENCE_TASK).catch(() => {});
    }
    registeredNotificationSessionRef.current = '';
    setSession(null);
    await AsyncStorage.removeItem(SESSION_KEY);
  };

  if (loading) {
    return (
      <ThemeContext.Provider value={isDarkMode}>
        <SafeAreaView style={[styles.app, isDarkMode && styles.appDark]}>
          <Ambient dark={isDarkMode} />
          <View style={styles.center}>
            <BrandLogo />
            <Text style={[styles.loadingText, isDarkMode && styles.loadingTextDark]}>Divane Society hazırlanıyor...</Text>
          </View>
        </SafeAreaView>
      </ThemeContext.Provider>
    );
  }

  return (
    <ThemeContext.Provider value={isDarkMode}>
      <SafeAreaView style={[styles.app, isDarkMode && styles.appDark]}>
        <StatusBar style={isDarkMode ? 'light' : 'dark'} />
        <Ambient dark={isDarkMode} />
        {session ? (
          <Dashboard
            session={session}
            onSignOut={signOut}
            customers={customers}
            appPosts={appPosts}
            staffAccounts={liveStaffAccounts}
            setStaffAccounts={updateStaffAccounts}
            setAppPosts={updateAppPosts}
            appStories={appStories}
            setAppStories={updateAppStories}
            appRewards={appRewards}
            setAppRewards={updateAppRewards}
            appCampaigns={appCampaigns}
            setAppCampaigns={updateAppCampaigns}
            reservations={liveReservations}
            setReservations={updateReservations}
            requests={liveRequests}
            setRequests={updateRequests}
            notifications={notifications}
            setNotifications={updateNotifications}
            customerMessages={customerMessages}
            setCustomerMessages={updateCustomerMessages}
            onSendBroadcast={sendBroadcast}
            onSendCustomerMessage={sendCustomerMessage}
            memberStats={memberStats}
            setMemberStats={updateMemberStats}
            onRefreshLiveData={refreshLiveData}
            onUploadMedia={uploadMedia}
            onCommitLiveData={commitLiveData}
            onUpdateProfile={updateCurrentProfile}
            onShowInAppNotification={showInAppNotification}
          />
        ) : (
          <AuthScreen
            customers={customers}
            staffAccounts={liveStaffAccounts}
            onRegisterCustomer={(newCustomer) => {
              const hasBirthdayGift = isBirthdayToday(newCustomer.birthDate);
              commitLiveData({
                customers: [newCustomer, ...customers],
                staffAccounts: liveStaffAccounts,
                reservations: liveReservations,
                requests: liveRequests,
                notifications,
                customerMessages,
                memberStats: {
                  ...memberStats,
                  [newCustomer.phone]: { checkIns: 0, monthlyCheckIns: 0, checkInProgress: 0, spinCredits: hasBirthdayGift ? 2 : 1, birthdayGiftYear: hasBirthdayGift ? currentYear() : undefined, spinRewards: [], rewardUses: [], checkInLog: [], checkInCodes: [] },
                },
              });
            }}
            onSignIn={signIn}
          />
        )}
        <InAppNotificationBanner notification={bannerNotification} onClose={() => setBannerNotification(null)} />
      </SafeAreaView>
    </ThemeContext.Provider>
  );
}

function AuthScreen({ customers, staffAccounts, onRegisterCustomer, onSignIn }) {
  const isDark = useDarkMode();
  const [mode, setMode] = useState('login');
  const [identifier, setIdentifier] = useState(demoCustomer.phone);
  const [password, setPassword] = useState('1234');
  const [remember, setRemember] = useState(true);
  const [fullName, setFullName] = useState('Ada Demir');
  const [email, setEmail] = useState(demoCustomer.email);
  const [birthDate, setBirthDate] = useState('21.05.1995');
  const [verificationMethod, setVerificationMethod] = useState('Telefon');
  const [verificationSent, setVerificationSent] = useState(false);
  const [sentCode, setSentCode] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

  const submit = () => {
    const normalizedPhone = identifier.replace(/\D/g, '').replace(/^90/, '').replace(/^0/, '');
    if (mode === 'signup') {
      const parsedBirthDate = parseBirthDate(birthDate);
      if (!/^5\d{9}$/.test(normalizedPhone)) {
        Alert.alert('Geçersiz telefon', 'Lütfen 5XXXXXXXXX formatında gerçek bir Türkiye GSM numarası girin.');
        return;
      }
      if (!parsedBirthDate || calculateAge(parsedBirthDate) < 18) {
        Alert.alert('Yaş doğrulaması', 'Divane Society üyeliği için 18 yaş ve üzeri olmak zorunludur. Doğum tarihini GG.AA.YYYY formatında gir.');
        return;
      }
      if (password.length < 4) {
        Alert.alert('Şifre kısa', 'Şifre en az 4 karakter olmalı.');
        return;
      }
      if (customers.some((customer) => customer.phone === normalizedPhone)) {
        Alert.alert('Kayıt mevcut', 'Bu telefon numarasıyla zaten üyelik var.');
        return;
      }
      if (!verificationSent) {
        const code = String(Math.floor(100000 + Math.random() * 900000));
        setSentCode(code);
        setVerificationSent(true);
        Alert.alert('Doğrulama kodu gönderildi', `Demo ${verificationMethod.toLowerCase()} doğrulama kodu: ${code}`);
        return;
      }
      if (verificationCode.trim() !== sentCode) {
        Alert.alert('Kod hatalı', 'Telefon/e-posta doğrulama kodunu kontrol et.');
        return;
      }
      const [firstName = 'Yeni', ...lastParts] = fullName.trim().split(' ');
      const newCustomer = {
        ...demoCustomer,
        firstName,
        lastName: lastParts.join(' ') || 'Üye',
        phone: normalizedPhone,
        email,
        password,
        birthDate: formatBirthDate(parsedBirthDate),
        verifiedAt: new Date().toISOString(),
        verificationMethod,
        tier: 'Silver Sadakat',
        favoriteVenue: 'Divane Lounge',
      };
      onRegisterCustomer(newCustomer);
      onSignIn({
        type: 'customer',
        role: 'Müşteri',
        user: newCustomer,
        remember: true,
      });
      return;
    }

    const staffAccount = staffAccounts.find((item) => item.id.toLowerCase() === identifier.trim().toLowerCase() && item.password === password);
    if (staffAccount) {
      onSignIn({ type: staffAccount.role === 'Personel' ? 'staff' : 'admin', role: staffAccount.role, user: staffAccount });
      return;
    }

    const customer = customers.find((item) => item.phone === normalizedPhone && item.password === password);
    if (customer) {
      onSignIn({ type: 'customer', role: 'Müşteri', user: customer, remember });
      return;
    }

    Alert.alert('Giriş bulunamadı', `Kayıtlı müşteri: ${demoCustomer.phone} / 1234\nPersonel ID: SA-001, ADM-101 veya PRS-210 / 1234`);
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" contentContainerStyle={styles.authContent}>
        <View style={styles.authHero}>
          <BrandLogo />
          <Text style={[styles.authTitle, isDark && styles.authTitleDark]}>Divane Society</Text>
          <Text style={[styles.authLead, isDark && styles.authLeadDark]}>Mekan storyleri, kampanyalar, QR katılım, sadakat ve ödüller tek premium üyelik deneyiminde.</Text>
        </View>

        <GlassPanel>
          <View style={[styles.authSwitch, isDark && styles.authSwitchDark]}>
            <Pressable onPress={() => setMode('login')} style={[styles.authSwitchButton, mode === 'login' && styles.authSwitchButtonActive, isDark && mode === 'login' && styles.authSwitchButtonActiveDark]}>
              <Text style={[styles.authSwitchText, mode === 'login' && styles.authSwitchTextActive]}>{copy.loginTitle}</Text>
            </Pressable>
            <Pressable onPress={() => setMode('signup')} style={[styles.authSwitchButton, mode === 'signup' && styles.authSwitchButtonActive, isDark && mode === 'signup' && styles.authSwitchButtonActiveDark]}>
              <Text style={[styles.authSwitchText, mode === 'signup' && styles.authSwitchTextActive]}>{copy.signupTitle}</Text>
            </Pressable>
          </View>
          <Text style={styles.panelTitle}>{mode === 'login' ? copy.loginTitle : copy.signupTitle}</Text>
          <Text style={styles.helper}>Müşteriler telefon numarasıyla, personel ve yöneticiler atanmış ID ile aynı panelden giriş yapar.</Text>
          {mode === 'signup' && (
            <>
              <Field label={copy.fullName} value={fullName} onChangeText={(value) => { setFullName(value); setVerificationSent(false); }} />
              <Field label={copy.email} value={email} onChangeText={(value) => { setEmail(value); setVerificationSent(false); }} keyboardType="email-address" />
              <Field label="Doğum tarihi" value={birthDate} onChangeText={(value) => { setBirthDate(value); setVerificationSent(false); }} placeholder="GG.AA.YYYY" keyboardType="numbers-and-punctuation" />
              <PickerRow label="Doğrulama yöntemi" values={['Telefon', 'E-posta']} onPick={(method) => { setVerificationMethod(method); setVerificationSent(false); setVerificationCode(''); }} initialValue={verificationMethod} />
              {verificationSent && (
                <>
                  <Field label="Doğrulama kodu" value={verificationCode} onChangeText={setVerificationCode} keyboardType="number-pad" />
                  <Text style={styles.helper}>{verificationMethod} için gönderilen 6 haneli demo kodunu gir.</Text>
                </>
              )}
            </>
          )}
          <Field label={copy.identifier} value={identifier} onChangeText={(value) => { setIdentifier(value); if (mode === 'signup') setVerificationSent(false); }} autoCapitalize="none" />
          <Field label={copy.password} value={password} onChangeText={setPassword} secureTextEntry />
          <Pressable style={styles.rememberRow} onPress={() => setRemember(!remember)}>
            <View style={[styles.checkbox, remember && styles.checkboxActive]} />
            <Text style={styles.bodyText}>{copy.remember}</Text>
          </Pressable>
          <PrimaryButton label={mode === 'login' ? copy.login : verificationSent ? 'Kodu Onayla ve Üye Ol' : 'Doğrulama Kodu Gönder'} onPress={submit} />
          <GlassListCard title="Hazır hesaplar" meta="5551112233, SA-001, ADM-101, PRS-210" right="1234" />
        </GlassPanel>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Dashboard({ session, onSignOut, customers, appPosts, staffAccounts, setStaffAccounts, setAppPosts, appStories, setAppStories, appRewards, setAppRewards, appCampaigns, setAppCampaigns, reservations, setReservations, requests, setRequests, notifications, setNotifications, customerMessages, setCustomerMessages, onSendBroadcast, onSendCustomerMessage, memberStats, setMemberStats, onRefreshLiveData, onUploadMedia, onCommitLiveData, onUpdateProfile, onShowInAppNotification }) {
  const isDark = useDarkMode();
  const tabs = session.type === 'customer' ? customerTabs : session.type === 'staff' ? staffTabs : adminTabs;
  const [activeTab, setActiveTab] = useState(tabs[0]);
  const [venueFilter, setVenueFilter] = useState('all');
  const [createMode, setCreateMode] = useState(null);
  const [usersList, setUsersList] = useState(initialUsers);
  const [refreshing, setRefreshing] = useState(false);
  const lastCustomerMessageRef = useRef(null);

  useEffect(() => setActiveTab(tabs[0]), [session.type]);

  const visiblePosts = useMemo(() => appPosts.filter((post) => venueFilter === 'all' || post.venue === venueFilter), [appPosts, venueFilter]);
  const visibleStories = useMemo(() => appStories.filter((story) => venueFilter === 'all' || story.venue === venueFilter), [appStories, venueFilter]);
  const customerPhone = session.user.phone;
  const memberRecord = customerPhone ? memberStats[customerPhone] || { checkIns: 0, spinRewards: [], rewardUses: [] } : null;
  const allowedVenueId = isVenueScopedRole(session.role) ? venueIdFromName(session.user.venue) : null;
  const scopedReservations = allowedVenueId ? reservations.filter((item) => venueIdFromName(item.venue) === allowedVenueId) : reservations;
  const scopedRequests = allowedVenueId ? requests.filter((item) => venueIdFromName(item.venue) === allowedVenueId) : requests;
  const scopedPosts = allowedVenueId ? appPosts.filter((item) => item.venue === allowedVenueId) : appPosts;
  const scopedStories = allowedVenueId ? appStories.filter((item) => item.venue === allowedVenueId) : appStories;
  const scopedNotifications = allowedVenueId ? notifications.filter((item) => item.venue === allowedVenueId || item.target === 'all') : notifications;
  const plusMode = session.type === 'admin' ? { Story: 'story', Gönderiler: 'post', Kampanyalar: 'campaign', Çark: 'reward', Personel: 'staff' }[activeTab] : null;
  const refresh = async () => {
    setRefreshing(true);
    await onRefreshLiveData?.();
    setRefreshing(false);
  };
  useEffect(() => {
    if (session.type !== 'customer') return undefined;
    const syncTimer = setInterval(() => onRefreshLiveData?.(), 5000);
    return () => clearInterval(syncTimer);
  }, [session.type, onRefreshLiveData]);
  useEffect(() => {
    if (session.type !== 'customer') return;
    const latestMessage = customerMessages.find((message) => message.phone === session.user.phone || message.phone === 'all');
    if (!latestMessage || latestMessage.id === lastCustomerMessageRef.current) return;
    lastCustomerMessageRef.current = latestMessage.id;
    onShowInAppNotification?.(latestMessage);
  }, [customerMessages, onShowInAppNotification, session.type, session.user.phone]);
  const createContent = (mode, payload) => {
    const venue = allowedVenueId ? venues.find((item) => item.id === allowedVenueId) : venues.find((item) => item.name === payload.venue) || venues[1];
    if (mode === 'story') {
      const nextStory = {
        id: makeId('ST'),
        venue: venue.id,
        title: payload.description || 'Yeni story',
        label: venue.name,
        time: '11:59 kaldı',
        likes: 0,
        image: payload.image,
        description: payload.description || 'Yeni story yayında.',
        comments: [],
      };
      const notification = { id: makeId('NT'), type: 'story', title: 'Yeni story yayında', text: `${venue.name} story paylaştı.`, venue: venue.id, target: 'admin', createdAt: 'Şimdi' };
      onCommitLiveData?.({ appStories: [nextStory, ...appStories], notifications: [notification, ...notifications] });
    } else if (mode === 'post') {
      const nextPost = {
        id: makeId('PO'),
        venue: venue.id,
        venueName: venue.name,
        date: 'Şimdi',
        title: venue.name,
        cta: 'Rezervasyon Yap',
        likes: 0,
        comments: [],
        image: payload.image,
        description: payload.description || 'Yeni paylaşım yayına alındı.',
      };
      const notification = { id: makeId('NT'), type: 'post', title: 'Yeni gönderi yayında', text: `${venue.name} akışta paylaşım yaptı.`, venue: venue.id, target: 'admin', createdAt: 'Şimdi' };
      onCommitLiveData?.({ appPosts: [nextPost, ...appPosts], notifications: [notification, ...notifications] });
    } else if (mode === 'campaign') {
      const title = payload.title || 'Yeni Kampanya';
      const notification = { id: makeId('NT'), type: 'campaign', title: 'Kampanya güncellendi', text: title, target: 'admin', createdAt: 'Şimdi' };
      onCommitLiveData?.({ appCampaigns: [title, ...appCampaigns], notifications: [notification, ...notifications] });
    } else if (mode === 'reward') {
      const title = payload.title || '+1 Kokteyl';
      const notification = { id: makeId('NT'), type: 'reward', title: 'Çark ödülü eklendi', text: title, target: 'admin', createdAt: 'Şimdi' };
      onCommitLiveData?.({ appRewards: [title, ...appRewards], notifications: [notification, ...notifications] });
    } else if (mode === 'staff') {
      const nextStaff = { ...payload, venue: allowedVenueId ? venueNameFromId(allowedVenueId) : payload.venue };
      const notification = { id: makeId('NT'), type: 'staff', title: 'Personel yetkisi oluşturuldu', text: `${nextStaff.name} · ${nextStaff.id} · ${nextStaff.venue}`, venue: venueIdFromName(nextStaff.venue), target: 'admin', createdAt: 'Şimdi' };
      onCommitLiveData?.({
        staffAccounts: [nextStaff, ...staffAccounts.filter((item) => item.id !== nextStaff.id)],
        notifications: [notification, ...notifications],
      });
    }
  };

  return (
    <View style={styles.flex}>
      <View style={[styles.topbar, isDark && styles.topbarDark]}>
        <View style={styles.topIdentity}>
          {plusMode && (
            <Pressable style={styles.adminPlus} onPress={() => setCreateMode(plusMode)}>
              <Text style={styles.adminPlusText}>+</Text>
            </Pressable>
          )}
          <BrandLogo compact />
          <View style={styles.topTextBlock}>
            <Text style={[styles.eyebrow, isDark && styles.eyebrowDark]} numberOfLines={1}>{session.role}</Text>
            <Text style={[styles.topTitle, isDark && styles.topTitleDark]} numberOfLines={1}>{session.user.firstName ? `${session.user.firstName} ${session.user.lastName}` : session.user.name}</Text>
          </View>
        </View>
        <Pressable style={[styles.logout, isDark && styles.logoutDark]} onPress={onSignOut}>
          <Text style={[styles.logoutText, isDark && styles.logoutTextDark]}>Çıkış</Text>
        </Pressable>
      </View>
      <MediaCreateModal mode={createMode} onCreate={createContent} onClose={() => setCreateMode(null)} onUploadMedia={onUploadMedia} allowedVenueId={allowedVenueId} />

      <ScrollView
        style={styles.flex}
        alwaysBounceVertical
        removeClippedSubviews={Platform.OS !== 'web'}
        keyboardShouldPersistTaps="handled"
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={styles.screenContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={BLUE} />}
      >
        {session.type === 'customer' && (
          <CustomerScreens
            activeTab={activeTab}
            session={session}
            venueFilter={venueFilter}
            setVenueFilter={setVenueFilter}
            visiblePosts={visiblePosts}
            visibleStories={visibleStories}
            allStories={appStories}
            allPosts={appPosts}
            setAppPosts={setAppPosts}
            setAppStories={setAppStories}
            rewards={appRewards}
            reservations={reservations}
            setReservations={setReservations}
            requests={requests}
            setRequests={setRequests}
            notifications={scopedNotifications}
            setNotifications={setNotifications}
            customerMessages={customerMessages}
            memberRecord={memberRecord}
            setMemberStats={setMemberStats}
            onUploadMedia={onUploadMedia}
            onUpdateProfile={onUpdateProfile}
          />
        )}
        {session.type === 'staff' && <StaffScreens activeTab={activeTab} session={session} setMemberStats={setMemberStats} memberStats={memberStats} reservations={scopedReservations.filter((item) => item.status === 'Onaylandı')} />}
        {session.type === 'admin' && (
          <AdminScreens
            session={session}
            activeTab={activeTab}
            customers={customers}
            usersList={usersList}
            setUsersList={setUsersList}
            staffList={staffAccounts}
            setStaffList={setStaffAccounts}
            appPosts={scopedPosts}
            setAppPosts={setAppPosts}
            appStories={scopedStories}
            setAppStories={setAppStories}
            appRewards={appRewards}
            setAppRewards={setAppRewards}
            appCampaigns={appCampaigns}
            setAppCampaigns={setAppCampaigns}
            reservations={scopedReservations}
            setReservations={setReservations}
            requests={scopedRequests}
            setRequests={setRequests}
            notifications={scopedNotifications}
            setNotifications={setNotifications}
            customerMessages={customerMessages}
            setCustomerMessages={setCustomerMessages}
            onSendBroadcast={onSendBroadcast}
            onSendCustomerMessage={onSendCustomerMessage}
            onUploadMedia={onUploadMedia}
            allowedVenueId={allowedVenueId}
            memberStats={memberStats}
            setMemberStats={setMemberStats}
          />
        )}
      </ScrollView>

      <View style={[styles.bottomTabShell, isDark && styles.bottomTabShellDark]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.blurTabbar, isDark && styles.blurTabbarDark]}>
          {tabs.map((tab) => (
            <Pressable key={tab} onPress={() => setActiveTab(tab)} style={[styles.tab, isDark && styles.tabDark, activeTab === tab && styles.tabActive]}>
              <Text style={[styles.tabIcon, isDark && styles.tabTextDark, activeTab === tab && styles.tabTextActive]}>{tabIcons[tab] || '•'}</Text>
              <Text style={[styles.tabText, isDark && styles.tabTextDark, activeTab === tab && styles.tabTextActive]}>{tab}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function CustomerScreens({ activeTab, session, venueFilter, setVenueFilter, visiblePosts, visibleStories, allStories, allPosts, setAppPosts, setAppStories, rewards, reservations, setReservations, requests, setRequests, notifications, setNotifications, customerMessages, memberRecord, setMemberStats, onUploadMedia, onUpdateProfile }) {
  const [activeStory, setActiveStory] = useState(null);
  const [activeStoryIndex, setActiveStoryIndex] = useState(0);
  const [likedPosts, setLikedPosts] = useState({});
  const [likedStories, setLikedStories] = useState({});
  const [comments, setComments] = useState(() => allPosts.reduce((acc, post) => ({ ...acc, [post.id]: post.comments }), {}));
  const [storyComments, setStoryComments] = useState(() => allStories.reduce((acc, story) => ({ ...acc, [story.id]: story.comments }), {}));
  const numericCheckIns = Number(memberRecord?.checkIns ?? 0);
  const checkInCount = Number.isFinite(numericCheckIns) ? numericCheckIns : 0;
  const checkInProgress = Number.isFinite(Number(memberRecord?.checkInProgress)) ? Number(memberRecord.checkInProgress) : checkInCount % 5;
  const spinRewards = Array.isArray(memberRecord?.spinRewards) ? memberRecord.spinRewards : [];
  const hasPendingReward = spinRewards.some((reward) => reward.status !== 'Kullanıldı' && !(memberRecord?.rewardUses || []).includes(rewardCode(reward)));
  const rawAvailableSpins = Number.isFinite(Number(memberRecord?.spinCredits))
    ? Math.max(0, Number(memberRecord.spinCredits))
    : Math.max(0, Math.floor(checkInCount / 5) - spinRewards.length);
  const availableSpins = hasPendingReward ? 0 : rawAvailableSpins;
  const authorName = session.user.firstName || session.user.name || 'Divane';
  const userKey = session.user.phone || authorName;
  useEffect(() => {
    setComments((current) => {
      const next = {};
      allPosts.forEach((post) => {
        next[post.id] = current[post.id] ?? post.comments ?? [];
      });
      return next;
    });
  }, [allPosts]);
  useEffect(() => {
    setStoryComments((current) => {
      const next = {};
      allStories.forEach((story) => {
        next[story.id] = current[story.id] ?? story.comments ?? [];
      });
      return next;
    });
  }, [allStories]);
  useEffect(() => {
    const next = {};
    allPosts.forEach((post) => {
      next[post.id] = Array.isArray(post.likedBy) && post.likedBy.includes(userKey);
    });
    setLikedPosts(next);
  }, [allPosts, userKey]);
  useEffect(() => {
    const next = {};
    allStories.forEach((story) => {
      next[story.id] = Array.isArray(story.likedBy) && story.likedBy.includes(userKey);
    });
    setLikedStories(next);
  }, [allStories, userKey]);

  const addComment = (postId, text) => {
    if (!text.trim()) return;
    const nextComment = { id: makeId('CM'), author: authorName, text: text.trim(), createdAt: new Date().toISOString() };
    setComments((current) => ({ ...current, [postId]: [...(current[postId] ?? []), nextComment] }));
    setAppPosts?.((current) => current.map((post) => post.id === postId ? { ...post, comments: [...(post.comments || []), nextComment] } : post));
    const post = allPosts.find((item) => item.id === postId);
    setNotifications((current) => [{ id: makeId('NT'), type: 'comment', title: 'Gönderiye yorum geldi', text: `${authorName}: ${text.trim()} · ${post?.venueName || 'Divane Society'}`, venue: post?.venue, target: 'admin', createdAt: 'Şimdi' }, ...current]);
  };

  const addStoryComment = (storyId, text) => {
    if (!text.trim()) return;
    const nextComment = { id: makeId('SCM'), author: authorName, text: text.trim(), createdAt: new Date().toISOString() };
    setStoryComments((current) => ({ ...current, [storyId]: [...(current[storyId] ?? []), nextComment] }));
    setAppStories?.((current) => current.map((story) => story.id === storyId ? { ...story, comments: [...(story.comments || []), nextComment] } : story));
    const story = allStories.find((item) => item.id === storyId);
    setNotifications((current) => [{ id: makeId('NT'), type: 'story-comment', title: 'Story yanıtı geldi', text: `${authorName}: ${text.trim()} · ${story?.label || 'Divane Society'}`, venue: story?.venue, target: 'admin', createdAt: 'Şimdi' }, ...current]);
  };
  const openVenueStory = (venueId) => {
    const group = allStories.filter((story) => story.venue === venueId);
    setActiveStory(group[0]);
    setActiveStoryIndex(0);
  };
  const currentStoryGroup = activeStory ? allStories.filter((story) => story.venue === activeStory.venue) : [];
  const nextStory = () => {
    if (!activeStory || currentStoryGroup.length === 0) return;
    const nextIndex = (activeStoryIndex + 1) % currentStoryGroup.length;
    setActiveStory(currentStoryGroup[nextIndex]);
    setActiveStoryIndex(nextIndex);
  };
  const previousStory = () => {
    if (!activeStory || currentStoryGroup.length === 0) return;
    const nextIndex = (activeStoryIndex - 1 + currentStoryGroup.length) % currentStoryGroup.length;
    setActiveStory(currentStoryGroup[nextIndex]);
    setActiveStoryIndex(nextIndex);
  };
  const nextVenueStory = (direction = 1) => {
    if (!activeStory) return;
    const venueIds = venues.filter((venue) => venue.id !== 'all').map((venue) => venue.id);
    const currentIndex = venueIds.indexOf(activeStory.venue);
    const nextVenueId = venueIds[(currentIndex + direction + venueIds.length) % venueIds.length];
    openVenueStory(nextVenueId);
  };

  if (activeTab === 'Ana Sayfa') {
    return (
      <>
        <HomeWelcome user={session.user} memberRecord={memberRecord} checkInCount={checkInCount} checkInProgress={checkInProgress} allStories={allStories} onOpenVenue={openVenueStory} />
        <SectionTitle title="Society Feed" action={`${visiblePosts.length} post`} />
        <VenueFilter value={venueFilter} onChange={setVenueFilter} />
        {visiblePosts.length === 0 ? (
          <EmptyState title="Henüz yayın yok" text="Admin panelinden story, gönderi veya etkinlik duyurusu eklendiğinde burada görünecek." />
        ) : (
          visiblePosts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              liked={Boolean(likedPosts[post.id])}
              comments={comments[post.id] ?? []}
              authorName={authorName}
              onLike={() => {
                const nextLiked = !likedPosts[post.id];
                setLikedPosts((current) => ({ ...current, [post.id]: nextLiked }));
                setAppPosts?.((current) => current.map((item) => {
                  if (item.id !== post.id) return item;
                  const likedBy = Array.isArray(item.likedBy) ? item.likedBy : [];
                  const alreadyLiked = likedBy.includes(userKey);
                  const nextLikedBy = nextLiked
                    ? Array.from(new Set([...likedBy, userKey]))
                    : likedBy.filter((id) => id !== userKey);
                  const likeDelta = nextLiked && !alreadyLiked ? 1 : !nextLiked && alreadyLiked ? -1 : 0;
                  return { ...item, likedBy: nextLikedBy, likes: Math.max(0, (Number(item.likes) || 0) + likeDelta) };
                }));
                if (nextLiked) setNotifications((current) => [{ id: makeId('NT'), type: 'like', title: 'Gönderi beğenildi', text: `${authorName}, ${post.venueName} gönderisini beğendi.`, venue: post.venue, target: 'admin', createdAt: 'Şimdi' }, ...current]);
              }}
              onComment={(text) => addComment(post.id, text)}
            />
          ))
        )}
        <StoryViewer
          story={activeStory}
          visible={Boolean(activeStory)}
          liked={activeStory ? Boolean(likedStories[activeStory.id]) : false}
          comments={activeStory ? storyComments[activeStory.id] ?? [] : []}
          storyIndex={activeStoryIndex}
          storyCount={currentStoryGroup.length}
          authorName={authorName}
          onClose={() => setActiveStory(null)}
          onNext={nextStory}
          onPrevious={previousStory}
          onNextVenue={nextVenueStory}
          onLike={() => activeStory && setLikedStories((current) => {
            const nextLiked = !current[activeStory.id];
            setAppStories?.((items) => items.map((story) => {
              if (story.id !== activeStory.id) return story;
              const likedBy = Array.isArray(story.likedBy) ? story.likedBy : [];
              const alreadyLiked = likedBy.includes(userKey);
              const nextLikedBy = nextLiked
                ? Array.from(new Set([...likedBy, userKey]))
                : likedBy.filter((id) => id !== userKey);
              const likeDelta = nextLiked && !alreadyLiked ? 1 : !nextLiked && alreadyLiked ? -1 : 0;
              return { ...story, likedBy: nextLikedBy, likes: Math.max(0, (Number(story.likes) || 0) + likeDelta) };
            }));
            if (nextLiked) setNotifications((items) => [{ id: makeId('NT'), type: 'story-like', title: 'Story beğenildi', text: `${authorName}, ${activeStory.label} storysini beğendi.`, venue: activeStory.venue, target: 'admin', createdAt: 'Şimdi' }, ...items]);
            return { ...current, [activeStory.id]: nextLiked };
          })}
          onComment={(text) => activeStory && addStoryComment(activeStory.id, text)}
        />
      </>
    );
  }

  if (activeTab === 'QR Katılım') return <QrParticipation user={session.user} memberRecord={memberRecord} checkInCount={checkInCount} checkInProgress={checkInProgress} availableSpins={availableSpins} />;
  if (activeTab === 'Çark') return <SpinWin user={session.user} rewards={rewards} checkInCount={checkInCount} checkInProgress={checkInProgress} availableSpins={availableSpins} lastPrize={spinRewards[0]} rewardUses={memberRecord?.rewardUses || []} onSpin={(winner) => setMemberStats((current) => {
    const existing = normalizeMemberRecord(current[session.user.phone] || { checkIns: checkInCount, checkInProgress, spinCredits: availableSpins, spinRewards: [], rewardUses: [] });
    if (existing.spinCredits <= 0) return current;
    return {
      ...current,
      [session.user.phone]: {
        ...existing,
        spinCredits: Math.max(0, existing.spinCredits - 1),
        spinRewards: [winner, ...(existing.spinRewards || [])],
      },
    };
  })} />;
  if (activeTab === 'Sadakat') return <LoyaltyDashboard user={session.user} memberRecord={memberRecord} checkInCount={checkInCount} checkInProgress={checkInProgress} availableSpins={availableSpins} usedSpins={spinRewards.length} activeRewards={spinRewards} rewardUses={memberRecord?.rewardUses || []} messages={customerMessages.filter((message) => message.phone === session.user.phone || message.phone === 'all')} />;
  if (activeTab === 'Rezervasyon') return <ReservationSystem items={reservations} setItems={setReservations} setNotifications={setNotifications} user={session.user} />;
  if (activeTab === 'İstek') return <RequestScreen items={requests} setItems={setRequests} setNotifications={setNotifications} user={session.user} />;
  return <ProfileScreen user={session.user} memberRecord={memberRecord} onUploadMedia={onUploadMedia} onSaveProfile={onUpdateProfile} />;
}

function StaffScreens({ activeTab, session, setMemberStats, memberStats, reservations }) {
  const [approvedScans, setApprovedScans] = useState([]);
  const [savedScan, setSavedScan] = useState(null);
  const approveScan = (scan) => {
    const scanPhone = scan.phone || demoCustomer.phone;
    const venueName = session.user.venue === 'Tüm Mekanlar' ? scan.venue : session.user.venue;
    const todayKey = societyDateKey();
    const existingRecord = normalizeMemberRecord(memberStats[scanPhone] || {});
    if (scan.type === 'Hediye' && scan.rewardId && (existingRecord.rewardUses || []).includes(scan.rewardId)) {
      const blocked = { ...scan, venue: venueName, status: 'Bu ödül kullanılmıştır' };
      setApprovedScans((current) => [blocked, ...current]);
      return { blocked: true, message: 'Bu ödül kullanılmıştır' };
    }
    if (scan.type === 'Katılım' && scan.code && (existingRecord.checkInCodes || []).includes(scan.code)) {
      const blocked = { ...scan, venue: venueName, status: 'Bu katılım QR daha önce okutuldu' };
      setApprovedScans((current) => [blocked, ...current]);
      return { blocked: true, message: 'Bu katılım QR daha önce okutuldu' };
    }
    if (scan.type === 'Katılım' && (existingRecord.checkInLog || []).some((entry) => entry.venue === venueName && societyDateKey(entry.at) === todayKey)) {
      const blocked = { ...scan, venue: venueName, status: 'Bu müşteri bugün bu mekanda zaten katılım yaptı' };
      setApprovedScans((current) => [blocked, ...current]);
      return { blocked: true, message: 'Bu müşteri bugün bu mekanda zaten katılım yaptı' };
    }
    if (scan.type === 'Katılım') {
      setMemberStats((current) => {
        const existing = normalizeMemberRecord(current[scanPhone] || {});
        const alreadyCheckedVenueToday = (existing.checkInLog || []).some((entry) => entry.venue === venueName && societyDateKey(entry.at) === todayKey);
        if (alreadyCheckedVenueToday || (scan.code && (existing.checkInCodes || []).includes(scan.code))) return current;
        const nextProgressRaw = existing.checkInProgress + 1;
        const earnedCredit = nextProgressRaw >= 5 ? 1 : 0;
        const nextProgress = nextProgressRaw % 5;
        return {
          ...current,
          [scanPhone]: {
            ...existing,
            checkIns: existing.checkIns + 1,
            monthlyCheckIns: monthlyCheckInCount(existing) + 1,
            checkInProgress: nextProgress,
            spinCredits: Math.max(0, existing.spinCredits + earnedCredit),
            checkInCodes: scan.code ? [scan.code, ...(existing.checkInCodes || [])].slice(0, 50) : existing.checkInCodes || [],
            checkInLog: [{ venue: venueName, venueDayKey: todayKey, staffId: session.user.id, staffName: session.user.name, at: new Date().toISOString() }, ...(existing.checkInLog || [])],
          },
        };
      });
    }
    if (scan.type === 'Hediye') {
      setMemberStats((current) => {
        const existing = normalizeMemberRecord(current[scanPhone] || {});
        if (scan.rewardId && (existing.rewardUses || []).includes(scan.rewardId)) return current;
        return {
          ...current,
          [scanPhone]: {
            ...existing,
            rewardUses: [scan.rewardId || scan.reward, ...(existing.rewardUses || [])],
            spinRewards: (existing.spinRewards || []).map((reward) => rewardCode(reward) === scan.rewardId ? { ...reward, status: 'Kullanıldı', usedAt: new Date().toISOString(), usedVenue: venueName } : reward),
          },
        };
      });
    }
    setApprovedScans((current) => [{
      ...scan,
      venue: venueName,
      status: 'Onaylandı',
      approvedAt: new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }),
    }, ...current]);
    return { blocked: false };
  };
  const dashboardScans = [...approvedScans, ...staffScans].slice(0, 8);
  if (activeTab === 'Dashboard') {
    return (
      <>
        <HeroPanel title="Personel Operasyon" subtitle={`${session.user.venue} vardiyası · 24 Mayıs`} stat={`${128 + approvedScans.filter((scan) => scan.type === 'Katılım').length}`} statLabel="Bugünkü giriş" />
        <MetricGrid items={[['QR Tara', `${42 + approvedScans.length}`], ['Katılım', `${approvedScans.filter((scan) => scan.type === 'Katılım').length}`], ['Hediye', `${approvedScans.filter((scan) => scan.type === 'Hediye').length}`], ['Rezervasyon', `${reservations.length}`], ['Onaylanan', `${approvedScans.filter((scan) => scan.status === 'Onaylandı').length}`]]} />
        {dashboardScans.map((scan, index) => <ScanResult key={`${scan.name}-${scan.approvedAt || index}`} scan={scan} />)}
      </>
    );
  }
  if (activeTab === 'QR Tara') return <ScannerPanel title="QR Tara" result={{ ...staffScans[0], venue: session.user.venue }} savedScan={savedScan} setSavedScan={setSavedScan} onApproved={approveScan} memberStats={memberStats} />;
  if (activeTab === 'Rezervasyonlar') return <ReservationList items={reservations} />;
  return null;
}

function AdminScreens({ session, activeTab, customers, usersList, setUsersList, staffList, setStaffList, appPosts, setAppPosts, appStories, setAppStories, appRewards, setAppRewards, appCampaigns, setAppCampaigns, reservations, setReservations, requests, setRequests, notifications, setNotifications, customerMessages, setCustomerMessages, onSendBroadcast, onSendCustomerMessage, onUploadMedia, allowedVenueId, memberStats, setMemberStats }) {
  if (activeTab === 'Dashboard') {
    return (
      <>
        <HeroPanel title="Bildirim Merkezi" subtitle={`${session.role} · ${allowedVenueId ? venueNameFromId(allowedVenueId) : 'Tüm Divane Society'}`} stat={`${notifications.length}`} statLabel="Yeni hareket" />
        <MetricGrid items={[['Yorum/Beğeni', `${notifications.filter((item) => String(item.type).includes('like') || String(item.type).includes('comment')).length}`], ['İstekler', `${requests.length}`], ['Rezervasyon', `${reservations.length}`], ['Yayınlar', `${appPosts.length + appStories.length}`], ['Kampanya', `${appCampaigns.length}`]]} />
        <AdminNotificationCenter notifications={notifications} requests={requests} reservations={reservations} onSendBroadcast={onSendBroadcast} onDeleteNotification={(id) => setNotifications((current) => current.filter((item) => item.id !== id))} />
      </>
    );
  }

  if (activeTab === 'Analytics') return <AnalyticsCharts />;
  if (activeTab === 'Kullanıcılar') {
    return (
      <>
        <ManagedUsers users={usersList} setUsers={setUsersList} customers={customers} memberStats={memberStats} setMemberStats={setMemberStats} canGrantSpin={session.role === 'Super Admin'} onSendCustomerMessage={onSendCustomerMessage} />
      </>
    );
  }
  if (activeTab === 'Mekanlar') return <VenueAdmin allowedVenueId={allowedVenueId} />;
  if (activeTab === 'Story') {
    return (
      <>
        <EditableStories items={appStories} setItems={setAppStories} onUploadMedia={onUploadMedia} />
      </>
    );
  }
  if (activeTab === 'Gönderiler') {
    return (
      <>
        <EditablePosts items={appPosts} setItems={setAppPosts} onUploadMedia={onUploadMedia} />
      </>
    );
  }
  if (activeTab === 'Rezervasyonlar') return <ReservationList items={reservations} setItems={setReservations} manage />;
  if (activeTab === 'Çark') return <EditableSimpleList title="Çark Ödülleri" items={appRewards} setItems={setAppRewards} meta="Çarkta görünür" />;
  if (activeTab === 'Kampanyalar') return <EditableSimpleList title="Kampanyalar" items={appCampaigns} setItems={setAppCampaigns} meta="Aktif kampanya" />;
  if (activeTab === 'İstekler') return <RequestList items={requests} setItems={setRequests} />;
  return (
    <>
      <EditableStaff staff={staffList} setStaff={setStaffList} />
    </>
  );
}

function AdminNotificationCenter({ notifications, requests, reservations, onSendBroadcast, onDeleteNotification }) {
  const [broadcast, setBroadcast] = useState('Bu gece Divane Society ayrıcalıkları aktif. QR katılımını unutma.');
  const sendBroadcast = () => {
    if (!broadcast.trim()) {
      Alert.alert('Bildirim boş', 'Göndermek için kısa bir bildirim metni yaz.');
      return;
    }
    onSendBroadcast?.(broadcast);
    Alert.alert('Bildirim gönderildi', 'Uygulama açıksa üst banner gösterilir. Kapalı cihazlar için push altyapı kuyruğuna kaydedildi.');
  };
  const [selectedItem, setSelectedItem] = useState(null);
  const feedRows = [
    ...notifications.map((item) => ({ id: item.id, kind: 'notification', title: item.title, meta: item.text, right: item.createdAt || 'Yeni', detail: item })),
    ...requests.slice(0, 3).map((item) => ({ id: item.id, kind: 'request', title: 'İstek / Şikayet', meta: `${item.venue} · ${item.title}`, right: item.status, detail: item })),
    ...reservations.slice(0, 3).map((item) => ({ id: item.id, kind: 'reservation', title: 'Rezervasyon', meta: `${item.venue} · ${item.date} ${item.time}`, right: item.status, detail: item })),
  ].slice(0, 12);
  return (
    <>
      <GlassPanel>
        <Text style={styles.panelTitle}>Canlı Hareketler</Text>
        {feedRows.length ? feedRows.map((row, index) => (
          <SwipeDeleteRow
            key={`${row.kind}-${row.id}-${index}`}
            onDelete={row.kind === 'notification' ? () => onDeleteNotification?.(row.id) : null}
            deleteTitle="Bildirim silinsin mi?"
          >
            <Pressable onPress={() => setSelectedItem(row)}>
              <GlassListCard title={row.title} meta={row.meta} right={row.right} />
            </Pressable>
          </SwipeDeleteRow>
        )) : <Text style={styles.helper}>Henüz hareket yok.</Text>}
      </GlassPanel>
      <GlassPanel>
        <Text style={styles.panelTitle}>Toplu Bildirim</Text>
        <Field label="Tüm kullanıcılara gönderilecek bildirim" value={broadcast} onChangeText={setBroadcast} multiline />
        <PrimaryButton label="Tüm Kullanıcılara Gönder" onPress={sendBroadcast} />
      </GlassPanel>
      <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </>
  );
}

function DetailModal({ item, onClose }) {
  if (!item) return null;
  const detail = item.detail || {};
  return (
    <Modal visible animationType="fade" transparent>
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmCard}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.confirmScrollContent}>
            <Text style={styles.eyebrow}>{item.right}</Text>
            <Text style={styles.panelTitle}>{item.title}</Text>
            <Text style={styles.helper}>{item.meta}</Text>
            {Object.entries(detail).slice(0, 8).map(([key, value]) => (
              <InfoRow key={key} label={key} value={String(value)} />
            ))}
            <PrimaryButton label="Kapat" onPress={onClose} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function HeroCard({ user, memberRecord, checkInCount = 0, checkInProgress }) {
  const safeCheckIns = Number.isFinite(Number(checkInCount)) ? Number(checkInCount) : 0;
  const progress = Number.isFinite(Number(checkInProgress)) ? Number(checkInProgress) : safeCheckIns % 5;
  const monthlyCount = monthlyCheckInCount(memberRecord || { checkIns: safeCheckIns });
  const tier = loyaltyTierFromMonthly(monthlyCount);
  return (
    <View style={styles.heroCard}>
      <View style={styles.heroCopy}>
        <Text style={styles.eyebrow}>{tier} · {progress}/5 katılım</Text>
        <Text style={styles.heroTitle}>Bu gece Divane Society’de.</Text>
        <Text style={styles.heroText}>Storyleri izle, QR ile katıl, çark hakkını aç ve rezervasyonunu tek ekrandan yönet.</Text>
      </View>
      <Image source={{ uri: getMediaUri(user.photo) }} style={styles.heroAvatar} />
    </View>
  );
}

function HomeWelcome({ user, memberRecord, checkInCount, checkInProgress, allStories, onOpenVenue }) {
  const brandStories = venues.filter((venue) => venue.id !== 'all');
  const storiesByVenue = useMemo(() => {
    const groups = {};
    allStories.forEach((story) => {
      if (!groups[story.venue]) groups[story.venue] = [];
      groups[story.venue].push(story);
    });
    return groups;
  }, [allStories]);
  return (
    <View style={styles.homeStickyBlock}>
      <View style={styles.homeLogoRow}>
        <BrandLogo compact />
        <Text style={styles.homeLogoText}>Divane Society</Text>
      </View>
      <HeroCard user={user} memberRecord={memberRecord} checkInCount={checkInCount} checkInProgress={checkInProgress} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.brandStoryRow}>
        {brandStories.map((venue) => {
          const venueStories = storiesByVenue[venue.id] || [];
          return (
            <Pressable key={venue.id} style={styles.brandStory} onPress={() => onOpenVenue(venue.id)}>
              <View style={[styles.brandStoryRing, venue.id === 'lounge' && styles.brandStoryRingDark, { borderColor: venue.accent }]}>
                <VenueLogo venueId={venue.id} />
              </View>
              <Text style={styles.brandStoryText}>{venue.name}</Text>
              <Text style={styles.brandStoryCount}>{venueStories.length} story</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const VenueLogo = memo(function VenueLogo({ venueId }) {
  return <Image source={venueLogos[venueId]} style={styles.brandStoryLogo} resizeMode="contain" />;
});

function VenueFilter({ value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filterRow}>
      {venues.map((venue) => (
        <Pressable key={venue.id} onPress={() => onChange(venue.id)} style={[styles.filterPill, value === venue.id && styles.filterPillActive]}>
          <Text style={[styles.filterText, value === venue.id && styles.filterTextActive]}>{venue.name}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}

function EmptyState({ title, text }) {
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.helper}>{text}</Text>
    </GlassPanel>
  );
}

function StoryBubble({ story, onPress }) {
  return (
    <Pressable onPress={onPress} style={styles.storyBubble}>
      <MediaPreview media={story.image} style={styles.storyThumb} />
      <View style={styles.storyGlassCap}>
        <Text style={styles.storyLabel}>{story.label}</Text>
        <Text style={styles.storyTitle} numberOfLines={2}>{story.description || story.title}</Text>
      </View>
    </Pressable>
  );
}

function PostCard({ post, liked, comments, authorName, onLike, onComment }) {
  const [draft, setDraft] = useState('');
  const [joined, setJoined] = useState(false);
  const [lastTap, setLastTap] = useState(0);
  const submit = () => {
    onComment(draft);
    setDraft('');
  };
  const handleMediaPress = () => {
    const now = Date.now();
    if (now - lastTap < 320) onLike();
    setLastTap(now);
  };
  return (
    <View style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.venueDot}><Text style={styles.venueDotText}>{post.venueName[0]}</Text></View>
        <View style={styles.postHeaderText}>
          <Text style={styles.postVenue} numberOfLines={1}>{post.venueName}</Text>
          <Text style={styles.postDate} numberOfLines={1}>{post.date}</Text>
        </View>
        <Pressable style={[styles.smallGlassButton, joined && styles.smallGlassButtonDone]} onPress={() => setJoined(!joined)}>
          <Text style={styles.smallGlassText} numberOfLines={2}>{joined ? 'Katıldın' : post.cta}</Text>
        </Pressable>
      </View>
      <Pressable onPress={handleMediaPress}>
        <MediaPreview media={post.image} style={styles.postImage} />
      </Pressable>
      <View style={styles.reactionBar}>
        <Pressable onPress={onLike}><Text style={[styles.reactionIcon, liked && styles.liked]}>{liked ? '♥' : '♡'}</Text></Pressable>
        <Text style={styles.reactionIcon}>💬</Text>
        <Text style={styles.reactionIcon}>↗</Text>
        <Text style={styles.reactionCount} numberOfLines={1}>{Number(post.likes) || 0} beğeni</Text>
      </View>
      <View style={styles.postBody}>
        <Text style={styles.postText}>{post.description}</Text>
        {comments.slice(-2).map((comment, index) => {
          const normalized = normalizeComment(comment, authorName);
          return <Text key={`${normalized.author}-${normalized.text}-${index}`} style={styles.commentText}>{normalized.author ? <Text style={styles.commentAuthor}>{normalized.author} </Text> : null}{normalized.text}</Text>;
        })}
        <View style={styles.commentComposer}>
          <TextInput value={draft} onChangeText={setDraft} placeholder="Yorum ekle..." placeholderTextColor="#8A97A8" style={styles.commentInput} />
          <Pressable onPress={submit}><Text style={styles.sendText} numberOfLines={1}>Paylaş</Text></Pressable>
        </View>
      </View>
    </View>
  );
}

function StoryViewer({ story, visible, liked, comments, storyIndex = 0, storyCount = 1, authorName, onClose, onNext, onPrevious, onNextVenue, onLike, onComment }) {
  const [draft, setDraft] = useState('');
  const [touchStart, setTouchStart] = useState(null);
  const [lastTap, setLastTap] = useState(0);
  const [playProgress, setPlayProgress] = useState(0);
  const [storyMuted, setStoryMuted] = useState(false);
  const onNextRef = useRef(onNext);
  useEffect(() => {
    onNextRef.current = onNext;
  }, [onNext]);
  useEffect(() => {
    if (!visible || !story) return undefined;
    setPlayProgress(0);
    setStoryMuted(false);
    let frame = null;
    const duration = STORY_DURATION_MS;
    const startedAt = Date.now();
    const tick = () => {
      const nextProgress = Math.min(1, (Date.now() - startedAt) / duration);
      setPlayProgress(nextProgress);
      if (nextProgress >= 1) {
        onNextRef.current?.();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      if (frame) cancelAnimationFrame(frame);
    };
  }, [story?.id, visible]);
  if (!story) return null;
  const safeStoryCount = Math.max(1, Number(storyCount) || 1);
  const safeStoryIndex = Math.min(safeStoryCount - 1, Math.max(0, Number(storyIndex) || 0));
  const submit = () => {
    onComment(draft);
    setDraft('');
  };
  const handleTouchEnd = (event) => {
    if (!touchStart) return;
    const touch = event.nativeEvent.changedTouches?.[0];
    if (!touch) return;
    const dx = touch.pageX - touchStart.x;
    const dy = touch.pageY - touchStart.y;
    if (dy > 70 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
    } else if (dx < -60) {
      onNextVenue(1);
    } else if (dx > 60) {
      onNextVenue(-1);
    }
    setTouchStart(null);
  };
  const handleStoryTap = (fallback) => {
    const now = Date.now();
    if (now - lastTap < 320) {
      onLike();
    } else {
      fallback();
    }
    setLastTap(now);
  };
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View
        style={styles.storyModal}
        onTouchStart={(event) => {
          const touch = event.nativeEvent.touches?.[0];
          if (touch) setTouchStart({ x: touch.pageX, y: touch.pageY });
        }}
        onTouchEnd={handleTouchEnd}
      >
        <MediaPreview media={story.image} style={styles.storyModalImage} dark storyMode muted={storyMuted} autoPlay />
        <View style={styles.storyShade} />
        <View style={styles.storyTapZones}>
          <Pressable style={styles.storyTapZone} onPress={() => handleStoryTap(onPrevious)} />
          <Pressable style={styles.storyTapZone} onPress={() => handleStoryTap(onNext)} />
        </View>
        <View style={styles.storyProgressStack}>
          {Array.from({ length: safeStoryCount }).map((_, index) => {
            const width = index < safeStoryIndex ? '100%' : index === safeStoryIndex ? `${Math.round(playProgress * 100)}%` : '0%';
            return (
              <View key={`story-progress-${index}`} style={styles.storyProgressSegment}>
                <View style={[styles.storyProgressFill, { width }]} />
              </View>
            );
          })}
        </View>
        <View style={styles.storyModalHeader}>
          <Text style={styles.storyModalTitle} numberOfLines={1}>{story.label}</Text>
          <Pressable onPress={onClose} style={styles.closeButton}><Text style={styles.closeText}>×</Text></Pressable>
        </View>
        {isVideoMedia(story.image) && (
          <Pressable style={styles.storySoundButton} onPress={() => setStoryMuted((current) => !current)}>
            <Text style={styles.storySoundText}>{storyMuted ? 'Sesi Aç' : 'Sesi Kapat'}</Text>
          </Pressable>
        )}
        <View style={styles.storyBottom}>
          <Text style={styles.storyCaption} numberOfLines={3}>{story.time} · {Number(story.likes) || 0} beğeni · {story.description || story.title}</Text>
          {comments.map((comment, index) => {
            const normalized = normalizeComment(comment, authorName);
            return <Text key={`${normalized.author}-${normalized.text}-${index}`} style={styles.storyComment} numberOfLines={2}>{normalized.author ? <Text style={styles.storyCommentAuthor}>{normalized.author}: </Text> : null}{normalized.text}</Text>;
          })}
          <View style={styles.storyActions}>
            <Pressable onPress={onLike} style={styles.roundAction}><Text style={[styles.roundActionText, liked && styles.liked]}>{liked ? '♥' : '♡'}</Text></Pressable>
            <TextInput value={draft} onChangeText={setDraft} placeholder="Yanıt gönder..." placeholderTextColor="rgba(255,255,255,.72)" style={styles.storyInput} />
            <Pressable onPress={submit} style={styles.storySend}><Text style={styles.storySendText} numberOfLines={1}>Gönder</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function QrParticipation({ user, memberRecord, checkInCount = 0, checkInProgress, availableSpins }) {
  const [seconds, setSeconds] = useState(60);
  const [qrSeed, setQrSeed] = useState(() => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  const safeCheckIns = Number.isFinite(Number(checkInCount)) ? Number(checkInCount) : 0;
  const progress = Number.isFinite(Number(checkInProgress)) ? Number(checkInProgress) : safeCheckIns % 5;
  const qrValue = `DS-CHECKIN:${user.phone}:${safeCheckIns}:${qrSeed}`;
  const checkInLog = Array.isArray(memberRecord?.checkInLog) ? memberRecord.checkInLog : [];
  const safeAvailableSpins = Number.isFinite(Number(availableSpins)) ? Number(availableSpins) : 0;
  const monthlyCount = monthlyCheckInCount(memberRecord || { checkIns: safeCheckIns });
  const tier = loyaltyTierFromMonthly(monthlyCount);
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds((current) => {
        if (current <= 1) {
          setQrSeed(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
          return 60;
        }
        return current - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    setSeconds(60);
    setQrSeed(`${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);
  }, [safeCheckIns]);
  return (
    <>
      <GlassPanel>
        <Text style={styles.eyebrow}>Aktif QR</Text>
        <Text style={styles.panelTitle}>{user.firstName} {user.lastName}</Text>
        <Text style={styles.helper}>{tier} · Bu QR 60 saniye geçerlidir</Text>
        <View style={styles.qrShell}>
          <QrPattern value={qrValue} />
          <View style={styles.qrGlow} />
        </View>
        <InfoRow label="Yenilenme süresi" value={`00:${String(seconds).padStart(2, '0')}`} />
        <InfoRow label="Katılım ilerlemesi" value={`${progress} / 5 giriş tamamlandı`} />
        <InfoRow label="Aylık sadakat" value={`${monthlyCount} katılım · ${tier}`} />
        <InfoRow label="Çark hakkı" value={`${safeAvailableSpins} aktif hak`} />
        <ProgressBar value={(progress / 5) * 100} />
      </GlassPanel>
      <SectionTitle title="Son girişler" action={`${safeCheckIns} toplam`} />
      {checkInLog.length ? checkInLog.slice(0, 6).map((item, index) => (
        <GlassListCard
          key={`${item.at || item.venue}-${index}`}
          title={item.venue || 'Divane Society'}
          meta={`${formatSocietyTime(item.at)} · ${item.staffName || 'Personel onayı'}`}
          right="+1 katılım"
        />
      )) : (
        <EmptyState title="Henüz gerçek giriş yok" text="Personel QR katılımını onayladığında son girişler burada sistem saatiyle görünür." />
      )}
    </>
  );
}

function SpinWin({ user, rewards = rewardOptions, checkInCount, checkInProgress, availableSpins, lastPrize, rewardUses = [], onSpin }) {
  const [rotation, setRotation] = useState(0);
  const [prize, setPrize] = useState(lastPrize || null);
  const [spinning, setSpinning] = useState(false);
  const [localConsumed, setLocalConsumed] = useState(0);
  const spinFrameRef = useRef(null);
  const wheelRewards = rewards.length ? rewards.slice(0, 6) : rewardOptions;
  const safeCheckIns = Number.isFinite(Number(checkInCount)) ? Number(checkInCount) : 0;
  const progress = Number.isFinite(Number(checkInProgress)) ? Number(checkInProgress) : safeCheckIns % 5;
  const safeAvailableSpins = Number.isFinite(Number(availableSpins)) ? Number(availableSpins) : 0;
  const visibleSpins = Math.max(0, safeAvailableSpins - localConsumed);
  const hasPrizeWaiting = Boolean(prize && !rewardUses.includes(rewardCode(prize)));
  const locked = visibleSpins <= 0;
  useEffect(() => {
    setLocalConsumed(0);
  }, [safeAvailableSpins, safeCheckIns]);
  useEffect(() => () => {
    if (spinFrameRef.current) cancelAnimationFrame(spinFrameRef.current);
  }, []);
  const spin = () => {
    if (spinning) return;
    if (locked) {
      Alert.alert('Çark hakkı yok', hasPrizeWaiting ? 'Önce aktif ödül QR kodunu personelde kullandırmalısın.' : `Çark çevirmek için 5 katılım gerekir. Şu an ${progress}/5 katılımın var.`);
      return;
    }
    setSpinning(true);
    const winnerIndex = Math.floor(Math.random() * wheelRewards.length);
    const winnerTitle = wheelRewards[winnerIndex];
    const winner = { id: makeId('RW'), title: winnerTitle, status: 'Kullanılabilir', createdAt: new Date().toISOString() };
    const segmentAngle = 360 / wheelRewards.length;
    const currentRotation = ((rotation % 360) + 360) % 360;
    const winnerCenterAngle = winnerIndex * segmentAngle + segmentAngle / 2;
    const targetRotation = rotation + (360 * 5) + ((360 - winnerCenterAngle - currentRotation + 360) % 360);
    const startRotation = rotation;
    const startedAt = Date.now();
    const spinDuration = 2300;
    const animate = () => {
      const progressRatio = Math.min(1, (Date.now() - startedAt) / spinDuration);
      const eased = 1 - Math.pow(1 - progressRatio, 3);
      setRotation(startRotation + (targetRotation - startRotation) * eased);
      if (progressRatio >= 1) {
        setRotation(targetRotation);
        setPrize(winner);
        setSpinning(false);
        setLocalConsumed((current) => current + 1);
        onSpin(winner);
        spinFrameRef.current = null;
        return;
      }
      spinFrameRef.current = requestAnimationFrame(animate);
    };
    spinFrameRef.current = requestAnimationFrame(animate);
  };
  return (
    <>
      <GlassPanel>
        <Text style={styles.eyebrow}>5 Katılım = 1 Çark</Text>
        <Text style={styles.panelTitle}>{visibleSpins > 0 ? `${visibleSpins} çark hakkın var` : hasPrizeWaiting ? 'Aktif ödülün var' : `${progress}/5 katılım tamamlandı`}</Text>
        <Text style={styles.helper}>{visibleSpins > 0 ? 'Hakkını kullandığında ödül QR kodun oluşturulur ve çark hakkın düşer.' : hasPrizeWaiting ? 'Ödül QR kodu kullanılmadan yeni çark çevrilemez.' : '5 katılım tamamlanmadan çark açılmaz. Ödül aldıysan yeni hak için tekrar 5 katılım gerekir.'}</Text>
        <View style={styles.wheelShell}>
          <View style={styles.wheelPointer}><Text style={styles.wheelPointerText}>▼</Text></View>
          <View style={[styles.wheel, locked && styles.wheelLocked, { transform: [{ rotate: `${rotation}deg` }] }]}>
            {wheelRewards.map((_, index) => (
              <View key={`segment-${index}`} style={[styles.wheelSegmentFill, wheelSegmentStyles[index], index % 2 === 0 && styles.wheelSegmentFillAlt]} />
            ))}
            {wheelRewards.map((_, index) => <View key={`spoke-${index}`} style={[styles.wheelSpoke, { transform: [{ rotate: `${index * 60}deg` }] }]} />)}
            {wheelRewards.map((reward, index) => (
              <View key={`${reward}-${index}`} style={[styles.wheelPrizeSlot, wheelSlotStyles[index], index % 2 === 0 && styles.wheelPrizeSlotAlt]}>
                <Text style={styles.wheelItem} numberOfLines={2}>{reward}</Text>
              </View>
            ))}
            <Pressable style={styles.wheelCore} onPress={spin}>
              <Text style={styles.wheelCoreText}>ÇEVİR</Text>
            </Pressable>
          </View>
        </View>
        <PrimaryButton label={spinning ? 'Çark dönüyor...' : locked ? 'Çark Hakkı Kilitli' : 'Çarkı Çevir'} onPress={spin} />
      </GlassPanel>
      {prize && (
        <GlassPanel>
          <Text style={styles.eyebrow}>Kazandığın Ödül</Text>
          <Text style={styles.bigWin}>{rewardTitle(prize)} Kazandın</Text>
          <QrPattern compact value={`DS-REWARD:${user.phone}:${rewardCode(prize)}:${encodeURIComponent(rewardTitle(prize))}`} />
          <InfoRow label="Kullanım süresi" value="23:42:16" />
          <InfoRow label="Geçerlilik" value={rewardUses.includes(rewardCode(prize)) ? 'Kullanıldı' : 'Kullanılabilir'} />
          <InfoRow label="Mekanlar" value="Divane Lounge · Divane Mey · Barney Pub" />
        </GlassPanel>
      )}
    </>
  );
}

function LoyaltyDashboard({ compact, user = demoCustomer, memberRecord, checkInCount = 4, checkInProgress, availableSpins, usedSpins = 0, activeRewards = [], rewardUses = [], messages = [] }) {
  const safeCheckIns = Number.isFinite(Number(checkInCount)) ? Number(checkInCount) : 0;
  const progress = Number.isFinite(Number(checkInProgress)) ? Number(checkInProgress) : safeCheckIns % 5;
  const safeAvailableSpins = Number.isFinite(Number(availableSpins)) ? Number(availableSpins) : Math.max(0, Math.floor(safeCheckIns / 5) - usedSpins);
  const monthlyCount = monthlyCheckInCount(memberRecord || { checkIns: safeCheckIns });
  const tier = loyaltyTierFromMonthly(monthlyCount);
  return (
    <>
      <DigitalLoyaltyCard user={user} tier={tier} monthlyCount={monthlyCount} checkInCount={safeCheckIns} checkInProgress={progress} availableSpins={safeAvailableSpins} />
      <GlassPanel>
        <Text style={styles.eyebrow}>{tier}</Text>
        <Text style={styles.panelTitle}>Sadakat Dashboard</Text>
        <MetricGrid items={[['Toplam giriş', `${safeCheckIns}`], ['Bu ay', `${monthlyCount}`], ['Seviye', tier.replace(' Sadakat', '')], ['Çark hakkı', `${safeAvailableSpins}`], ['Kullanılan', `${usedSpins}`]]} />
      </GlassPanel>
      <GlassPanel>
        <Text style={styles.panelTitle}>Sadakat seviyesi</Text>
        <InfoRow label="Silver Sadakat" value="Ayda 0-5 katılım" />
        <InfoRow label="Bronz Sadakat" value="Ayda 6-14 katılım" />
        <InfoRow label="Gold Sadakat" value="Ayda 15+ katılım" />
        <InfoRow label="Sonraki hedef" value={nextTierText(monthlyCount)} />
        <ProgressBar value={Math.min(100, monthlyCount >= 15 ? 100 : monthlyCount >= 6 ? (monthlyCount / 15) * 100 : (monthlyCount / 6) * 100)} />
      </GlassPanel>
      <GlassPanel>
        <Text style={styles.panelTitle}>Mekan bazlı dağılım</Text>
        <Bar label="Divane Lounge" value={8} max={8} />
        <Bar label="Divane Mey" value={4} max={8} />
        <Bar label="Barney Pub" value={3} max={8} />
      </GlassPanel>
      {messages.length > 0 && (
        <GlassPanel>
          <Text style={styles.panelTitle}>Yönetici Mesajları</Text>
          {messages.map((message) => <GlassListCard key={message.id} title={message.title || 'Divane Society'} meta={message.text} right={message.createdAt || 'Yeni'} />)}
        </GlassPanel>
      )}
      {!compact && <RewardQrList rewards={activeRewards} user={user} rewardUses={rewardUses} />}
    </>
  );
}

function DigitalLoyaltyCard({ user = demoCustomer, tier = 'Silver Sadakat', monthlyCount = 0, checkInCount = 4, checkInProgress, availableSpins = 0 }) {
  const safeCheckIns = Number.isFinite(Number(checkInCount)) ? Number(checkInCount) : 0;
  const progress = Number.isFinite(Number(checkInProgress)) ? Number(checkInProgress) : safeCheckIns % 5;
  return (
    <View style={styles.loyaltyCard}>
      <View style={styles.loyaltyCardTop}>
        <View>
          <Text style={styles.loyaltyCardEyebrow}>Divane Society</Text>
          <Text style={styles.loyaltyCardTitle}>{tier}</Text>
        </View>
        <Text style={styles.loyaltyCardNumber}>DS-8429</Text>
      </View>
      <View style={styles.loyaltyCardMiddle}>
        <View>
          <Text style={styles.loyaltyCardLabel}>{user.firstName || 'Ada'} {user.lastName || 'Demir'}</Text>
          <Text style={styles.loyaltyCardSub}>{progress} / 5 çark · Bu ay {monthlyCount} katılım · {availableSpins} hak</Text>
        </View>
        <QrPattern compact value={`DS-CARD:${user.phone || demoCustomer.phone}:${encodeURIComponent(tier)}:DS-8429`} />
      </View>
      <View style={styles.loyaltyStampRow}>
        {[1, 2, 3, 4, 5].map((stamp) => <View key={stamp} style={[styles.loyaltyStamp, stamp <= progress && styles.loyaltyStampActive]}><Text style={styles.loyaltyStampText}>{stamp}</Text></View>)}
      </View>
    </View>
  );
}

function ReservationSystem({ items, setItems, setNotifications, user }) {
  const [form, setForm] = useState({ venue: 'Divane Lounge', date: '24 Mayıs', time: '20.00', people: '2', area: 'Ana Salon' });
  const [pending, setPending] = useState(null);
  const customerItems = items.filter((item) => !item.phone || item.phone === user.phone);
  const addReservation = () => {
    const nextReservation = { id: makeId('RZ'), ...pending, people: Number(pending.people), status: 'Beklemede', customer: `${user.firstName} ${user.lastName}`, phone: user.phone };
    setItems((current) => [nextReservation, ...current]);
    setNotifications?.((current) => [{ id: makeId('NT'), type: 'reservation', title: 'Yeni rezervasyon talebi', text: `${nextReservation.customer} · ${nextReservation.venue} · ${nextReservation.date} ${nextReservation.time}`, venue: venueIdFromName(nextReservation.venue), target: 'admin', createdAt: 'Şimdi' }, ...current]);
    setPending(null);
  };
  return (
    <>
      <GlassPanel>
        <Text style={styles.panelTitle}>Glass Reservation</Text>
        <PickerRow label="Mekan seç" values={['Divane Lounge', 'Divane Mey', 'Barney Pub']} onPick={(venue) => setForm({ ...form, venue })} />
        <PickerRow label="Tarih seç" values={['24 Mayıs', '25 Mayıs', '26 Mayıs']} onPick={(date) => setForm({ ...form, date })} />
        <PickerRow label="Saat seç" values={['20.00', '21.30', '23.00']} onPick={(time) => setForm({ ...form, time })} />
        <PickerRow label="Kişi sayısı" values={['2', '4', '6']} onPick={(people) => setForm({ ...form, people })} />
        <PickerRow label="Alan seçimi" values={['Ana Salon', 'VIP', 'Bahçe', 'Bar Önü']} onPick={(area) => setForm({ ...form, area })} />
        <PrimaryButton label="Rezervasyon Oluştur" onPress={() => setPending({ ...form })} />
      </GlassPanel>
      <RecordPanel
        title="Rezervasyonlarım"
        items={customerItems}
        emptyText="Henüz rezervasyon yok."
        getTitle={(item) => `${item.id} · ${item.venue}`}
        getMeta={(item) => `${item.customer || 'Müşteri'} · ${item.date} ${item.time} · ${item.area} · ${item.people} kişi`}
        getRight={(item) => item.status}
        onDelete={(id) => setItems((current) => current.filter((item) => item.id !== id))}
      />
      <ConfirmModal
        visible={Boolean(pending)}
        title="Rezervasyonu onaylıyor musun?"
        text={pending ? `${pending.venue} · ${pending.date} ${pending.time} · ${pending.area} · ${pending.people} kişi` : ''}
        confirmLabel="Onayla"
        onCancel={() => setPending(null)}
        onConfirm={addReservation}
      />
    </>
  );
}

function RequestScreen({ items, setItems, setNotifications, user }) {
  const [form, setForm] = useState({ category: 'Şikayet', venue: 'Divane Lounge', title: 'VIP booth talebi', text: 'Cumartesi gecesi için daha sakin, sahneye yakın bir alan rica ediyoruz.' });
  const [pending, setPending] = useState(null);
  const customerItems = items.filter((item) => !item.phone || item.phone === user.phone);
  const submit = () => {
    const nextRequest = { id: makeId('SI'), ...pending, customer: `${user.firstName} ${user.lastName}`, phone: user.phone, status: 'Yeni' };
    setItems((current) => [nextRequest, ...current]);
    setNotifications?.((current) => [{ id: makeId('NT'), type: 'request', title: 'Yeni istek / şikayet', text: `${nextRequest.category} · ${nextRequest.venue} · ${nextRequest.title}`, venue: venueIdFromName(nextRequest.venue), target: 'admin', createdAt: 'Şimdi' }, ...current]);
    setPending(null);
  };
  return (
    <>
      <GlassPanel>
        <Text style={styles.panelTitle}>Şikayet / İstek</Text>
        <PickerRow label="Kategori" values={['Şikayet', 'Öneri', 'VIP Talebi', 'Rezervasyon Talebi', 'Doğum Günü Talebi']} onPick={(category) => setForm({ ...form, category })} />
        <PickerRow label="Mekan seçimi" values={['Divane Lounge', 'Divane Mey', 'Barney Pub']} onPick={(venue) => setForm({ ...form, venue })} />
        <Field label="Başlık" value={form.title} onChangeText={(title) => setForm({ ...form, title })} />
        <Field label="Mesaj" value={form.text} onChangeText={(text) => setForm({ ...form, text })} multiline />
        <GlassListCard title="Fotoğraf ekleme" meta="Masa konumu referansı eklendi" right="1 görsel" />
        <PrimaryButton label="Gönder" onPress={() => setPending({ ...form })} />
      </GlassPanel>
      <RecordPanel
        title="Önceki talepler"
        items={customerItems}
        emptyText="Henüz talep yok."
        getTitle={(item) => `${item.category} · ${item.venue}`}
        getMeta={(item) => `${item.customer || 'Müşteri'} · ${item.title}`}
        getRight={(item) => item.status}
        onDelete={(id) => setItems((current) => current.filter((item) => item.id !== id))}
      />
      <ConfirmModal
        visible={Boolean(pending)}
        title="Talebi göndermeyi onaylıyor musun?"
        text={pending ? `${pending.category} · ${pending.venue}\n${pending.title}` : ''}
        confirmLabel="Gönder"
        onCancel={() => setPending(null)}
        onConfirm={submit}
      />
    </>
  );
}

function ConfirmModal({ visible, title, text, confirmLabel, onCancel, onConfirm }) {
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.confirmOverlay}>
        <View style={styles.confirmCard}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.confirmScrollContent}>
            <Text style={styles.panelTitle}>{title}</Text>
            <Text style={styles.helper}>{text}</Text>
            <View style={styles.confirmActions}>
              <Pressable style={styles.confirmCancel} onPress={onCancel}><Text style={styles.confirmCancelText} numberOfLines={2}>Vazgeç</Text></Pressable>
              <Pressable style={styles.confirmButton} onPress={onConfirm}><Text style={styles.confirmButtonText} numberOfLines={2}>{confirmLabel}</Text></Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function InAppNotificationBanner({ notification, onClose }) {
  const isDark = useDarkMode();
  if (!notification) return null;
  return (
    <Pressable style={[styles.inAppBanner, isDark && styles.inAppBannerDark]} onPress={onClose}>
      <View style={styles.inAppBannerGlow} />
      <Text style={[styles.inAppBannerTitle, isDark && styles.inAppBannerTitleDark]} numberOfLines={1}>{notification.title || 'Divane Society'}</Text>
      <Text style={[styles.inAppBannerText, isDark && styles.inAppBannerTextDark]} numberOfLines={2}>{notification.text || notification.body || 'Yeni bildirimin var.'}</Text>
    </Pressable>
  );
}

function ProfileScreen({ user, memberRecord, onUploadMedia, onSaveProfile }) {
  const [profile, setProfile] = useState(user);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoStatus, setPhotoStatus] = useState('');
  const record = normalizeMemberRecord(memberRecord || {});
  const availableSpins = Math.max(0, record.spinCredits || 0);
  const profileTier = loyaltyTierFromMonthly(monthlyCheckInCount(record));
  const photoUri = getMediaUri(profile.photo) || demoCustomer.photo;
  const photoDetail = typeof profile.photo === 'object'
    ? profile.photo.width && profile.photo.height
      ? `${profile.photo.width} × ${profile.photo.height} · serviste kayıtlı`
      : 'Serviste kayıtlı profil fotoğrafı'
    : 'Aktif profil fotoğrafı';
  useEffect(() => {
    setProfile(user);
  }, [user]);
  const pickProfilePhoto = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Fotoğraf izni gerekli', 'Profil fotoğrafı seçmek için fotoğraf arşivine erişim ver.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      base64: false,
      quality: 0.9,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    const pendingMedia = {
      uri: asset.uri,
      localUri: asset.uri,
      type: 'image',
      fileName: asset.fileName || `profil-${profile.phone || Date.now()}.jpg`,
      mimeType: asset.mimeType || 'image/jpeg',
      width: asset.width,
      height: asset.height,
      uploadedAt: new Date().toISOString(),
    };
    setPhotoStatus('Profil fotoğrafı yükleniyor...');
    const servedMedia = onUploadMedia ? await onUploadMedia(pendingMedia) : pendingMedia;
    if (servedMedia?.uploadFailed) {
      setPhotoStatus('');
      Alert.alert('Fotoğraf yüklenemedi', servedMedia.error || 'Profil fotoğrafı servise aktarılamadı.');
      return;
    }
    setProfile((current) => ({ ...current, photo: servedMedia }));
    setPhotoStatus('Profil fotoğrafı servise eklendi.');
  };
  const saveProfile = async () => {
    if (!String(profile.firstName || '').trim() || !String(profile.lastName || '').trim()) {
      Alert.alert('Eksik profil', 'Ad ve soyad alanları boş bırakılamaz.');
      return;
    }
    const parsedBirthDate = parseBirthDate(profile.birthDate);
    if (!parsedBirthDate || calculateAge(parsedBirthDate) < 18) {
      Alert.alert('Yaş doğrulaması', 'Profil için geçerli doğum tarihi zorunlu. Divane Society 18 yaş ve üzeri içindir.');
      return;
    }
    setSaving(true);
    const cleanedProfile = {
      ...profile,
      firstName: String(profile.firstName || '').trim(),
      lastName: String(profile.lastName || '').trim(),
      email: String(profile.email || '').trim(),
      birthDate: formatBirthDate(parsedBirthDate),
      favoriteVenue: profile.favoriteVenue || 'Divane Lounge',
    };
    try {
      const savedProfile = await onSaveProfile?.(cleanedProfile);
      setProfile(savedProfile || cleanedProfile);
      setEditing(false);
      setPhotoStatus('');
      Alert.alert('Profil güncellendi', 'Bilgilerin ve profil fotoğrafın kaydedildi.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <>
      <GlassPanel>
        <View style={styles.profileHeader}>
          <Pressable style={styles.profilePhotoShell} onPress={editing ? pickProfilePhoto : undefined}>
            <Image source={{ uri: photoUri }} style={styles.profilePhoto} />
            {editing && <Text style={styles.profilePhotoEdit}>Değiştir</Text>}
          </Pressable>
          <View style={styles.profileTextBlock}>
            <Text style={styles.panelTitle} numberOfLines={2}>{profile.firstName} {profile.lastName}</Text>
            <Text style={styles.helper} numberOfLines={2}>{profileTier} · {profile.favoriteVenue || 'Divane Society'}</Text>
          </View>
        </View>
        {editing ? (
          <>
            <Field label="Ad" value={profile.firstName} onChangeText={(firstName) => setProfile({ ...profile, firstName })} />
            <Field label="Soyad" value={profile.lastName} onChangeText={(lastName) => setProfile({ ...profile, lastName })} />
            <Field label="E-posta" value={profile.email} onChangeText={(email) => setProfile({ ...profile, email })} />
            <Field label="Doğum tarihi" value={profile.birthDate || ''} onChangeText={(birthDate) => setProfile({ ...profile, birthDate })} placeholder="GG.AA.YYYY" keyboardType="numbers-and-punctuation" />
            <Field label="Telefon" value={profile.phone} editable={false} />
            <Field label="Şifre" value={profile.password || ''} onChangeText={(password) => setProfile({ ...profile, password })} secureTextEntry />
            <PickerRow
              label="Favori mekan"
              values={['Divane Lounge', 'Divane Mey', 'Barney Pub']}
              initialValue={profile.favoriteVenue || 'Divane Lounge'}
              onPick={(favoriteVenue) => setProfile({ ...profile, favoriteVenue })}
            />
            <GlassListCard title="Profil fotoğrafı" meta={photoStatus || photoDetail} right={editing ? 'Seçilebilir' : 'Aktif'} />
          </>
        ) : (
          <>
            <InfoRow label="Telefon" value={profile.phone} />
            <InfoRow label="E-posta" value={profile.email} />
            <InfoRow label="Doğum tarihi" value={profile.birthDate || 'Eklenmedi'} />
            <InfoRow label="Yaş doğrulaması" value={profile.verifiedAt ? 'Doğrulandı · 18+' : 'Bekliyor'} />
            <InfoRow label="Favori mekan" value={profile.favoriteVenue || 'Divane Lounge'} />
            <InfoRow label="Profil fotoğrafı" value={photoDetail} />
          </>
        )}
        {editing ? (
          <>
            <PrimaryButton label={saving ? 'Kaydediliyor...' : 'Profili Kaydet'} onPress={saveProfile} />
            <SecondaryButton label="Vazgeç" onPress={() => { setProfile(user); setPhotoStatus(''); setEditing(false); }} />
          </>
        ) : (
          <PrimaryButton label="Profili Düzenle" onPress={() => setEditing(true)} />
        )}
      </GlassPanel>
      <LoyaltyDashboard compact user={profile} memberRecord={record} checkInCount={record.checkIns} checkInProgress={record.checkInProgress} availableSpins={availableSpins} usedSpins={record.spinRewards.length} activeRewards={record.spinRewards} rewardUses={record.rewardUses} />
    </>
  );
}

function ScannerPanel({ title, result, savedScan, setSavedScan, onApproved, memberStats }) {
  const [scanState, setScanState] = useState(savedScan?.status === 'Onaylandı' ? 'approved' : savedScan?.code ? 'scanned' : 'idle');
  const [permission, requestPermission] = useCameraPermissions();
  const [scannedCode, setScannedCode] = useState(savedScan?.code || '');
  const [approvedResult, setApprovedResult] = useState(savedScan?.status === 'Onaylandı' ? savedScan : null);
  const [modalVisible, setModalVisible] = useState(Boolean(savedScan?.code));
  const parsedScan = parseSocietyQr(scannedCode, result, memberStats);
  const status = scanState === 'approved' ? (approvedResult?.status || 'Onaylandı') : scanState === 'scanned' ? (parsedScan.status || 'Okundu') : 'Kamera bekleniyor';
  const canScan = permission?.granted && scanState === 'idle';
  const handleScan = ({ data }) => {
    const nextCode = data || 'Divane Society QR';
    const nextScan = parseSocietyQr(nextCode, result, memberStats);
    setScannedCode(nextCode);
    setScanState('scanned');
    setModalVisible(true);
    setSavedScan?.({ ...nextScan, code: nextCode, status: nextScan.status || 'Kullanılabilir' });
  };
  const approveCurrentScan = () => {
    if (scanState !== 'scanned') return;
    const approved = { ...parsedScan, code: scannedCode, status: 'Onaylandı' };
    const result = onApproved?.(approved);
    const finalScan = result?.blocked ? { ...approved, status: result.message || 'Bu ödül kullanılmıştır' } : approved;
    setApprovedResult(finalScan);
    setScanState('approved');
    setSavedScan?.({ ...finalScan, code: scannedCode });
  };
  const resetScanner = () => {
    setScanState('idle');
    setScannedCode('');
    setApprovedResult(null);
    setModalVisible(false);
    setSavedScan?.(null);
  };
  return (
    <>
      <GlassPanel>
        <Text style={styles.panelTitle}>{title}</Text>
        <View style={styles.cameraFrame}>
          {permission?.granted ? (
            <CameraView
              style={styles.cameraPreview}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
              onBarcodeScanned={canScan ? handleScan : undefined}
            />
          ) : (
            <View style={styles.cameraPermissionPane}>
              <Text style={styles.cameraPermissionTitle}>Kamera izni gerekli</Text>
              <Text style={styles.cameraPermissionText}>QR kodu okutmak için kameraya erişim ver.</Text>
            </View>
          )}
          <View style={styles.cameraTopBar}>
            <Text style={styles.cameraLive}>● Kamera</Text>
            <Text style={styles.cameraLiveMuted}>{permission?.granted ? 'QR alanını ortala' : 'İzin bekleniyor'}</Text>
          </View>
          <View style={styles.scanReticle}>
            <Text style={styles.scanReticleText}>QR</Text>
          </View>
          <Text style={styles.scanHint}>{scanState === 'idle' ? 'QR kodu kameraya göster' : `QR okundu: ${scannedCode.slice(0, 28)}`}</Text>
        </View>
        {!permission?.granted && <PrimaryButton label="Kamera İzni Ver" onPress={requestPermission} />}
      </GlassPanel>
      <Modal visible={modalVisible} animationType="slide" transparent>
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.confirmScrollContent}>
              <Text style={styles.eyebrow}>QR İşlemi</Text>
              <Text style={styles.panelTitle}>{scanState === 'approved' ? approvedResult?.status || 'Onaylandı' : parsedScan.type === 'Hediye' ? 'Hediye QR Okundu' : 'Katılım QR Okundu'}</Text>
              <ScanResult scan={{ ...(approvedResult || parsedScan), status }} />
              {approvedResult && (
                <GlassListCard title={approvedResult.status === 'Onaylandı' ? `${approvedResult.type} tamamlandı` : approvedResult.status} meta={approvedResult.reward} right={approvedResult.status === 'Onaylandı' ? 'Sisteme işlendi' : 'Tekrar kullanılamaz'} />
              )}
              {scanState === 'scanned' ? (
                <View style={styles.confirmActions}>
                  <Pressable style={styles.confirmCancel} onPress={resetScanner}><Text style={styles.confirmCancelText} numberOfLines={2}>Vazgeç</Text></Pressable>
                  <Pressable style={styles.confirmButton} onPress={approveCurrentScan}><Text style={styles.confirmButtonText} numberOfLines={2}>{parsedScan.type === 'Hediye' ? 'Ödülü Onayla' : 'Katılımı Onayla'}</Text></Pressable>
                </View>
              ) : (
                <PrimaryButton label="Yeni QR Tara" onPress={resetScanner} />
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

function parseSocietyQr(code, fallback, memberStats = {}) {
  if (!code) return fallback;
  const parts = code.split(':');
  if (parts[0] === 'DS-CHECKIN') {
    return {
      name: fallback.name,
      phone: parts[1],
      venue: fallback.venue,
      reward: `Katılım QR · ${parts[1] || 'üye'} · v${parts[2] || '1'}`,
      type: 'Katılım',
      status: 'Kullanılabilir',
    };
  }
  if (parts[0] === 'DS-REWARD') {
    const rewardId = parts[2];
    const phone = parts[1];
    const used = rewardId && (memberStats[phone]?.rewardUses || []).includes(rewardId);
    return {
      name: fallback.name,
      phone,
      venue: 'Divane Lounge · Divane Mey · Barney Pub',
      rewardId,
      reward: decodeURIComponent(parts[3] || 'Society ödülü'),
      type: 'Hediye',
      status: used ? 'Bu ödül kullanılmıştır' : 'Kullanılabilir',
    };
  }
  return {
    ...fallback,
    phone: fallback.phone || demoCustomer.phone,
    type: 'Katılım',
    reward: `QR · ${code.slice(0, 36)}`,
    status: 'Kullanılabilir',
  };
}

function ScanResult({ scan }) {
  return (
    <GlassListCard title={scan.name} meta={`${scan.venue} · ${scan.reward}`} right={scan.status} />
  );
}

function ReservationList({ items = reservations, setItems, manage = false }) {
  const [selectedItem, setSelectedItem] = useState(null);
  const updateStatus = (id, status) => {
    setItems?.((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  };
  const deleteItem = (id) => {
    setItems?.((current) => current.filter((item) => item.id !== id));
  };
  if (manage) {
    return (
      <GlassPanel>
        <Text style={styles.panelTitle}>Rezervasyon Yönetimi</Text>
        <Text style={styles.helper}>Rezervasyonu açmak için karta dokun. Sola kaydırınca silme seçeneği gelir.</Text>
        {items.map((item) => (
          <SwipeDeleteRow key={item.id} onDelete={() => deleteItem(item.id)} deleteTitle={`${item.id} silinsin mi?`}>
            <Pressable style={styles.editableRow} onPress={() => setSelectedItem({ title: `${item.id} · ${item.customer || 'Misafir'}`, meta: `${item.venue} · ${item.date} ${item.time} · ${item.area} · ${item.people} kişi`, right: item.status, detail: item })}>
              <View style={styles.editableRowText}>
                <Text style={styles.listTitle} numberOfLines={2}>{item.id} · {item.customer || 'Misafir'}</Text>
                <Text style={styles.listMeta} numberOfLines={3}>{item.venue} · {item.date} {item.time} · {item.area} · {item.people} kişi</Text>
              </View>
              <Text style={styles.statusBadge} numberOfLines={2}>{item.status}</Text>
              <Pressable style={styles.rowAction} onPress={() => updateStatus(item.id, 'Onaylandı')}><Text style={styles.rowActionText} numberOfLines={1}>Onayla</Text></Pressable>
            </Pressable>
          </SwipeDeleteRow>
        ))}
        <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
      </GlassPanel>
    );
  }
  return (
    <AdminList title="Rezervasyon geçmişi" rows={items.map((item) => `${item.id} · ${item.customer || 'Müşteri'} · ${item.venue} · ${item.date} ${item.time} · ${item.area} · ${item.people} kişi · ${item.status}`)} />
  );
}

function RequestList({ items = [], setItems }) {
  const [selectedItem, setSelectedItem] = useState(null);
  const updateStatus = (id, status) => {
    setItems?.((current) => current.map((item) => item.id === id ? { ...item, status } : item));
  };
  const deleteItem = (id) => {
    setItems?.((current) => current.filter((item) => item.id !== id));
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Şikayet / İstekler</Text>
      {items.map((item) => (
        <SwipeDeleteRow key={item.id} onDelete={() => deleteItem(item.id)} deleteTitle={`${item.title} silinsin mi?`}>
          <Pressable style={styles.editableRow} onPress={() => setSelectedItem({ title: `${item.category} · ${item.title}`, meta: `${item.venue} · ${item.customer || 'Müşteri'}`, right: item.status, detail: item })}>
            <View style={styles.editableRowText}>
              <Text style={styles.listTitle} numberOfLines={2}>{item.category} · {item.title}</Text>
              <Text style={styles.listMeta} numberOfLines={3}>{item.venue} · {item.customer || 'Müşteri'} · {item.text}</Text>
            </View>
            <Text style={styles.statusBadge} numberOfLines={2}>{item.status}</Text>
            <Pressable style={styles.rowAction} onPress={() => updateStatus(item.id, 'Onaylandı')}><Text style={styles.rowActionText} numberOfLines={1}>Onayla</Text></Pressable>
          </Pressable>
        </SwipeDeleteRow>
      ))}
      <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </GlassPanel>
  );
}

function VenueAdmin({ allowedVenueId }) {
  const visibleVenues = venues.filter((venue) => venue.id !== 'all' && (!allowedVenueId || venue.id === allowedVenueId));
  return (
    <>
      {visibleVenues.map((venue, index) => (
        <GlassPanel key={venue.id}>
          <Text style={styles.panelTitle}>{venue.name}</Text>
          <Bar label="Doluluk" value={[84, 72, 68][index]} max={100} />
          <InfoRow label="Bugünkü rezervasyon" value={`${[42, 31, 28][index]}`} />
          <InfoRow label="Memnuniyet" value={`%${[96, 93, 91][index]}`} />
        </GlassPanel>
      ))}
    </>
  );
}

function AnalyticsCharts() {
  return (
    <>
      <GlassPanel>
        <Text style={styles.panelTitle}>Mekan bazlı kullanıcı dağılımı</Text>
        <Bar label="Divane Lounge" value={48} max={60} />
        <Bar label="Divane Mey" value={36} max={60} />
        <Bar label="Barney Pub" value={29} max={60} />
      </GlassPanel>
      <GlassPanel>
        <Text style={styles.panelTitle}>Günlük giriş yoğunluğu</Text>
        <MiniBars values={[34, 42, 58, 76, 92, 128, 486]} />
      </GlassPanel>
      <AdminList title="En aktif müşteriler" rows={['Selin Ak · 38 giriş · Platinum', 'Ada Demir · 24 giriş · Gold', 'Bora Şen · 18 giriş · Gold']} />
    </>
  );
}

function AdminList({ title, rows }) {
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>{title}</Text>
      {rows.map((row, index) => <GlassListCard key={`${title}-${index}-${row}`} title={row.split(' · ')[0]} meta={row.split(' · ').slice(1, -1).join(' · ') || row} right={row.split(' · ').slice(-1)[0]} />)}
    </GlassPanel>
  );
}

function SwipeDeleteRow({ children, onDelete, deleteTitle = 'Kayıt silinsin mi?' }) {
  const [revealed, setRevealed] = useState(false);
  const touchStart = useRef(null);
  const confirmDelete = () => {
    Alert.alert(deleteTitle, 'Bu kayıt listeden kaldırılacak.', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Sil', style: 'destructive', onPress: onDelete },
    ]);
  };
  return (
    <View
      style={styles.swipeShell}
      onTouchStart={(event) => {
        const touch = event.nativeEvent.touches?.[0];
        if (touch) touchStart.current = { x: touch.pageX, y: touch.pageY };
      }}
      onTouchEnd={(event) => {
        if (!touchStart.current || !onDelete) return;
        const touch = event.nativeEvent.changedTouches?.[0];
        if (!touch) return;
        const dx = touch.pageX - touchStart.current.x;
        const dy = touch.pageY - touchStart.current.y;
        if (dx < -44 && Math.abs(dx) > Math.abs(dy)) setRevealed(true);
        if (dx > 44 && Math.abs(dx) > Math.abs(dy)) setRevealed(false);
        touchStart.current = null;
      }}
    >
      {revealed && onDelete && (
        <Pressable style={styles.swipeDelete} onPress={confirmDelete}>
          <Text style={styles.swipeDeleteText}>Sil</Text>
        </Pressable>
      )}
      <View style={[styles.swipeContent, revealed && onDelete && styles.swipeContentRevealed]}>{children}</View>
    </View>
  );
}

function RecordPanel({ title, items, emptyText, getTitle, getMeta, getRight, onDelete }) {
  const [selectedItem, setSelectedItem] = useState(null);
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>{title}</Text>
      {items.length ? items.map((item) => {
        const row = {
          title: getTitle(item),
          meta: getMeta(item),
          right: getRight(item),
          detail: item,
        };
        return (
          <SwipeDeleteRow key={item.id} onDelete={() => onDelete?.(item.id)} deleteTitle={`${row.title} silinsin mi?`}>
            <Pressable onPress={() => setSelectedItem(row)}>
              <GlassListCard title={row.title} meta={row.meta} right={row.right} />
            </Pressable>
          </SwipeDeleteRow>
        );
      }) : <Text style={styles.helper}>{emptyText}</Text>}
      <DetailModal item={selectedItem} onClose={() => setSelectedItem(null)} />
    </GlassPanel>
  );
}

function RewardQrList({ rewards = [], user = demoCustomer, rewardUses = [] }) {
  const activeRewards = rewards.filter((reward) => reward.status !== 'Kullanıldı' && !rewardUses.includes(rewardCode(reward)));
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Aktif ödüller</Text>
      {activeRewards.length ? activeRewards.map((reward) => (
        <View key={rewardCode(reward)} style={styles.rewardQrRow}>
          <View style={styles.rewardQrText}>
            <Text style={styles.listTitle} numberOfLines={2}>{rewardTitle(reward)}</Text>
            <Text style={styles.listMeta} numberOfLines={3}>{reward.status || 'Kullanılabilir'} · Tüm mekanlarda geçerli · Personel QR ile onaylar</Text>
          </View>
          <QrPattern compact value={`DS-REWARD:${user.phone || demoCustomer.phone}:${rewardCode(reward)}:${encodeURIComponent(rewardTitle(reward))}`} />
        </View>
      )) : <Text style={styles.helper}>Henüz kullanılabilir çark ödülü yok.</Text>}
    </GlassPanel>
  );
}

function ModuleGrid({ items }) {
  return (
    <View style={styles.moduleGrid}>
      {items.map((item) => <View key={item} style={styles.modulePill}><Text style={styles.moduleText}>{item}</Text></View>)}
    </View>
  );
}

function ManagedUsers({ users, setUsers, customers = [], memberStats = {}, setMemberStats, canGrantSpin = false, onSendCustomerMessage }) {
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [messageTarget, setMessageTarget] = useState(null);
  const [messageText, setMessageText] = useState('Sadakat paneline özel not: Bu hafta Divane Society avantajın aktif.');
  const liveUsers = customers.length ? customers.map((customer, index) => ({
    id: customer.phone,
    name: `${customer.firstName} ${customer.lastName}`,
    phone: customer.phone,
    tier: customer.tier || 'Gold Member',
    visits: normalizeMemberRecord(memberStats[customer.phone] || {}).checkIns,
    spinCredits: normalizeMemberRecord(memberStats[customer.phone] || {}).spinCredits,
  })) : users;
  const grantSpin = (phone) => {
    const currentCredits = normalizeMemberRecord(memberStats[phone] || {}).spinCredits;
    if (currentCredits >= 1) {
      Alert.alert('Aktif hak var', 'Bu kullanıcının zaten kullanılabilir çark hakkı var. Adil kullanım için ekstra hak verilmedi.');
      return;
    }
    setMemberStats?.((current) => {
      const existing = normalizeMemberRecord(current[phone] || {});
      return {
        ...current,
        [phone]: {
          ...existing,
          spinCredits: 1,
        },
      };
    });
    Alert.alert('Çark hakkı tanımlandı', `${phone} numaralı kullanıcıya 1 hediye çark hakkı verildi.`);
  };
  const save = () => {
    if (!editingId || !draft) return;
    setUsers((current) => current.map((item) => item.id === editingId ? { ...item, ...draft, visits: Number(draft.visits) || 0 } : item));
    setEditingId(null);
    setDraft(null);
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Kullanıcı Verileri</Text>
      <Text style={styles.helper}>Kullanıcılar uygulamadan kendi kayıt olur. Admin burada kullanıcı kartını görüntüler, üyelik seviyesini düzenler veya hesabı pasife alır.</Text>
      {draft && (
        <>
          <Field label="Ad Soyad" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          <Field label="Telefon" value={draft.phone} onChangeText={(phone) => setDraft({ ...draft, phone })} />
          <PickerRow label="Üyelik" values={['Gold', 'Silver', 'Platinum']} onPick={(tier) => setDraft({ ...draft, tier })} initialValue={draft.tier} />
          <Field label="Giriş sayısı" value={`${draft.visits}`} onChangeText={(visits) => setDraft({ ...draft, visits })} keyboardType="number-pad" />
          <PrimaryButton label="Kullanıcıyı Güncelle" onPress={save} />
        </>
      )}
      {messageTarget && (
        <View style={styles.messageComposerCard}>
          <Text style={styles.panelTitle}>{messageTarget.name}</Text>
          <Text style={styles.helper}>Bu mesaj müşterinin Sadakat panelinde görüntülenir, cevaplanamaz.</Text>
          <Field label="Mesaj" value={messageText} onChangeText={setMessageText} multiline />
          <View style={styles.confirmActions}>
            <Pressable style={styles.confirmCancel} onPress={() => setMessageTarget(null)}><Text style={styles.confirmCancelText} numberOfLines={2}>Vazgeç</Text></Pressable>
            <Pressable style={styles.confirmButton} onPress={() => { onSendCustomerMessage?.(messageTarget.phone, messageText); setMessageTarget(null); }}><Text style={styles.confirmButtonText} numberOfLines={2}>Gönder</Text></Pressable>
          </View>
        </View>
      )}
      {liveUsers.map((user) => (
        <View key={user.id} style={styles.editableRow}>
          <View style={styles.editableRowText}>
            <Text style={styles.listTitle} numberOfLines={2}>{user.name}</Text>
            <Text style={styles.listMeta} numberOfLines={3}>{user.phone} · {user.tier} · {user.visits} giriş · {user.spinCredits || 0} çark hakkı</Text>
          </View>
          <Pressable style={styles.rowAction} onPress={() => { setDraft({ ...user, visits: `${user.visits}` }); setEditingId(user.id); }}><Text style={styles.rowActionText} numberOfLines={1}>Düzenle</Text></Pressable>
          {canGrantSpin && <Pressable style={styles.rowAction} onPress={() => grantSpin(user.phone)}><Text style={styles.rowActionText} numberOfLines={1}>Hak Ver</Text></Pressable>}
          <Pressable style={styles.rowAction} onPress={() => setMessageTarget(user)}><Text style={styles.rowActionText} numberOfLines={1}>Mesaj</Text></Pressable>
          <Pressable style={[styles.rowAction, styles.rowDelete]} onPress={() => setUsers((current) => current.filter((item) => item.id !== user.id))}><Text style={styles.rowDeleteText} numberOfLines={1}>Sil</Text></Pressable>
        </View>
      ))}
    </GlassPanel>
  );
}

function EditableStaff({ staff, setStaff }) {
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (editingId && draft) {
      setStaff((current) => current.map((item) => item.id === editingId ? draft : item));
      setEditingId(null);
      setDraft(null);
    }
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Personel Yönetimi</Text>
      <Text style={styles.helper}>Yeni personel eklemek için bu paneldeyken üstteki + butonunu kullan. Burada mevcut yetkileri düzenleyebilir veya silebilirsin.</Text>
      {draft && (
        <>
          <Field label="Ad Soyad" value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
          <Field label="Atanmış ID" value={draft.id} onChangeText={(id) => setDraft({ ...draft, id })} />
          <Field label="Şifre" value={draft.password} onChangeText={(password) => setDraft({ ...draft, password })} />
          <PickerRow label="Rol" values={['Personel', 'Mekan Admini', 'Super Admin']} onPick={(role) => setDraft({ ...draft, role })} initialValue={draft.role} />
          <PickerRow label="Mekan" values={['Divane Lounge', 'Divane Mey', 'Barney Pub', 'Tüm Mekanlar']} onPick={(venue) => setDraft({ ...draft, venue })} initialValue={draft.venue} />
          <PrimaryButton label="Personeli Güncelle" onPress={save} />
        </>
      )}
      {staff.map((person) => (
        <EditableRow
          key={person.id}
          title={person.name}
          meta={`${person.id} · ${person.role}`}
          right={person.venue}
          onEdit={() => { setDraft(person); setEditingId(person.id); }}
          onDelete={() => setStaff((current) => current.filter((item) => item.id !== person.id))}
        />
      ))}
    </GlassPanel>
  );
}

function EditableStories({ items, setItems, onUploadMedia }) {
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!draft || !editingId) return;
    if (!draft.image) {
      Alert.alert('Medya seç', 'Story güncellemek için telefondan bir fotoğraf veya video seçmelisin.');
      return;
    }
    const venue = venues.find((item) => item.id === draft.venue) || venues[1];
    const next = { ...draft, label: venue.name, time: '11:59 kaldı', likes: draft.likes ?? 0, comments: draft.comments ?? [] };
    if (editingId) {
      setItems((current) => current.map((item) => item.id === editingId ? { ...item, ...next } : item));
      setEditingId(null);
      setDraft(null);
    }
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Story Yönetimi</Text>
      <Text style={styles.helper}>Yeni story eklemek için bu paneldeyken üstteki + butonunu kullan.</Text>
      {draft && (
        <>
          <PickerRow label="Mekan" values={['lounge', 'mey', 'barney']} onPick={(venue) => setDraft({ ...draft, venue })} initialValue={draft.venue} />
          <Field label="Açıklama" value={draft.description || draft.title} onChangeText={(description) => setDraft({ ...draft, description, title: description })} />
          <MediaPickerInline media={draft.image} onPick={(image) => setDraft({ ...draft, image })} onUploadMedia={onUploadMedia} aspectMode="story" />
          <PrimaryButton label="Story Güncelle" onPress={save} />
        </>
      )}
      {items.map((story) => (
        <EditableRow
          key={story.id}
          title={story.title}
          meta={`${story.label} · ${story.time}`}
          right={`${story.likes} beğeni`}
          onEdit={() => { setDraft({ venue: story.venue, title: story.title, description: story.description || story.title, image: story.image, likes: story.likes, comments: story.comments }); setEditingId(story.id); }}
          onDelete={() => setItems((current) => current.filter((item) => item.id !== story.id))}
        />
      ))}
    </GlassPanel>
  );
}

function EditablePosts({ items, setItems, onUploadMedia }) {
  const [draft, setDraft] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const save = () => {
    if (!draft || !editingId) return;
    if (!draft.image) {
      Alert.alert('Medya seç', 'Gönderi güncellemek için telefondan bir fotoğraf veya video seçmelisin.');
      return;
    }
    const venue = venues.find((item) => item.id === draft.venue) || venues[1];
    const next = { ...draft, venueName: venue.name, date: 'Şimdi', cta: 'Rezervasyon Yap', likes: draft.likes ?? 0, comments: draft.comments ?? [] };
    if (editingId) {
      setItems((current) => current.map((item) => item.id === editingId ? { ...item, ...next } : item));
      setEditingId(null);
      setDraft(null);
    }
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>Gönderi Yönetimi</Text>
      <Text style={styles.helper}>Yeni gönderi eklemek için bu paneldeyken üstteki + butonunu kullan.</Text>
      {draft && (
        <>
          <PickerRow label="Mekan" values={['lounge', 'mey', 'barney']} onPick={(venue) => setDraft({ ...draft, venue })} initialValue={draft.venue} />
          <Field label="Açıklama" value={draft.description} onChangeText={(description) => setDraft({ ...draft, description })} multiline />
          <MediaPickerInline media={draft.image} onPick={(image) => setDraft({ ...draft, image })} onUploadMedia={onUploadMedia} aspectMode="post" />
          <PrimaryButton label="Gönderiyi Güncelle" onPress={save} />
        </>
      )}
      {items.map((post) => (
        <EditableRow
          key={post.id}
          title={post.title}
          meta={`${post.venueName} · ${post.description}`}
          right={`${post.likes} beğeni`}
          onEdit={() => { setDraft({ venue: post.venue, title: post.title, description: post.description, image: post.image, likes: post.likes, comments: post.comments }); setEditingId(post.id); }}
          onDelete={() => setItems((current) => current.filter((item) => item.id !== post.id))}
        />
      ))}
    </GlassPanel>
  );
}

function EditableSimpleList({ title, items, setItems, meta }) {
  const [draft, setDraft] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const save = () => {
    if (!draft.trim() || editingIndex === null) return;
    setItems((current) => current.map((item, index) => index === editingIndex ? draft.trim() : item));
    setDraft('');
    setEditingIndex(null);
  };
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>{title}</Text>
      <Text style={styles.helper}>Yeni kayıt eklemek için bu paneldeyken üstteki + butonunu kullan.</Text>
      {editingIndex !== null && (
        <>
          <Field label="Başlık" value={draft} onChangeText={setDraft} />
          <PrimaryButton label="Güncelle" onPress={save} />
        </>
      )}
      {items.map((item, index) => (
        <EditableRow
          key={`${item}-${index}`}
          title={item}
          meta={meta}
          right="Aktif"
          onEdit={() => { setDraft(item); setEditingIndex(index); }}
          onDelete={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}
        />
      ))}
    </GlassPanel>
  );
}

function EditableRow({ title, meta, right, onEdit, onDelete }) {
  return (
    <View style={styles.editableRow}>
      <View style={styles.editableRowText}>
        <Text style={styles.listTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.listMeta} numberOfLines={3}>{meta}</Text>
      </View>
      <Text style={styles.statusBadge} numberOfLines={2}>{right}</Text>
      <Pressable style={styles.rowAction} onPress={onEdit}><Text style={styles.rowActionText} numberOfLines={1}>Düzenle</Text></Pressable>
      <Pressable style={[styles.rowAction, styles.rowDelete]} onPress={onDelete}><Text style={styles.rowDeleteText} numberOfLines={1}>Sil</Text></Pressable>
    </View>
  );
}

function CreationPanel({ title, fields, button }) {
  const [media, setMedia] = useState(null);
  const [saved, setSaved] = useState(false);
  return (
    <GlassPanel>
      <Text style={styles.panelTitle}>{title}</Text>
      <View style={styles.creationGrid}>
        {fields.map((field, index) => (
          <View key={field} style={styles.creationField}>
            <Text style={styles.fieldLabel}>{field}</Text>
            <Text style={styles.creationValue}>{sampleValue(field, index)}</Text>
          </View>
        ))}
      </View>
      {(title.includes('Story') || title.includes('Gönderi')) && (
        <MediaPickerInline media={media} onPick={setMedia} />
      )}
      <PrimaryButton label={saved ? 'Kaydedildi' : button} onPress={() => setSaved(true)} />
    </GlassPanel>
  );
}

async function assetToDataUri(asset) {
  if (asset.type === 'image' && asset.base64) {
    return `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`;
  }
  try {
    const response = await fetch(asset.uri);
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    return asset.uri;
  }
}

function MediaCreateModal({ mode, onCreate, onClose, onUploadMedia, allowedVenueId }) {
  const [media, setMedia] = useState(null);
  const [venue, setVenue] = useState(allowedVenueId ? venueNameFromId(allowedVenueId) : 'Divane Lounge');
  const [title, setTitle] = useState(mode === 'story' ? 'Yeni Story' : 'Yeni Gönderi');
  const [description, setDescription] = useState(mode === 'story' ? 'Bu geceki atmosferden 12 saatlik story' : 'Yaklaşan etkinlik duyurusu');
  const [staffDraft, setStaffDraft] = useState({ id: `PRS-${Date.now().toString().slice(-3)}`, password: '1234', role: 'Personel', venue: allowedVenueId ? venueNameFromId(allowedVenueId) : 'Divane Lounge', name: 'Yeni Personel' });
  const [pendingStaff, setPendingStaff] = useState(null);
  const needsMedia = mode === 'story' || mode === 'post';
  const isStaff = mode === 'staff';
  useEffect(() => {
    if (!mode) return;
    setMedia(null);
    setVenue(allowedVenueId ? venueNameFromId(allowedVenueId) : 'Divane Lounge');
    setTitle(mode === 'story' ? 'Yeni Story' : mode === 'post' ? 'Yeni Gönderi' : mode === 'campaign' ? 'Yeni Kampanya' : mode === 'staff' ? 'Yeni Personel' : '+1 Kokteyl');
    setDescription(mode === 'story' ? 'Bu geceki atmosferden 12 saatlik story' : mode === 'post' ? 'Yaklaşan etkinlik duyurusu' : '');
    setPendingStaff(null);
    setStaffDraft({ id: `PRS-${Date.now().toString().slice(-3)}`, password: '1234', role: 'Personel', venue: allowedVenueId ? venueNameFromId(allowedVenueId) : 'Divane Lounge', name: 'Yeni Personel' });
  }, [mode, allowedVenueId]);
  if (!mode) return null;
  const modalTitle = mode === 'story' ? 'Story paylaş' : mode === 'post' ? 'Gönderi paylaş' : mode === 'campaign' ? 'Kampanya ekle' : mode === 'staff' ? 'Personel ekle' : 'Çark ödülü ekle';
  const publishLabel = mode === 'story' ? 'Story Yayınla' : mode === 'post' ? 'Gönderiyi Yayınla' : mode === 'campaign' ? 'Kampanyayı Ekle' : mode === 'staff' ? 'Personeli Hazırla' : 'Ödülü Ekle';
  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.mediaModalOverlay}>
        <View style={styles.mediaModalCard}>
          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.mediaModalContent}>
            <View style={styles.mediaModalHeader}>
              <Text style={styles.panelTitle}>{modalTitle}</Text>
              <Pressable onPress={onClose} style={styles.mediaClose}><Text style={styles.closeLite}>×</Text></Pressable>
            </View>
            {isStaff ? (
              <>
                <Field label="Ad Soyad" value={staffDraft.name} onChangeText={(name) => setStaffDraft({ ...staffDraft, name })} />
                <Field label="Atanmış ID" value={staffDraft.id} onChangeText={(id) => setStaffDraft({ ...staffDraft, id })} autoCapitalize="characters" />
                <Field label="Şifre" value={staffDraft.password} onChangeText={(password) => setStaffDraft({ ...staffDraft, password })} />
                <PickerRow label="Rol" values={allowedVenueId ? ['Personel', 'Mekan Admini'] : ['Personel', 'Mekan Admini', 'Super Admin']} onPick={(role) => setStaffDraft({ ...staffDraft, role })} initialValue={staffDraft.role} />
                {allowedVenueId ? <InfoRow label="Mekan" value={venueNameFromId(allowedVenueId)} /> : <PickerRow label="Mekan" values={['Divane Lounge', 'Divane Mey', 'Barney Pub', 'Tüm Mekanlar']} onPick={(staffVenue) => setStaffDraft({ ...staffDraft, venue: staffVenue })} initialValue={staffDraft.venue} />}
              </>
            ) : (
              <>
                {needsMedia && (allowedVenueId ? <InfoRow label="Mekan" value={venueNameFromId(allowedVenueId)} /> : <PickerRow label="Mekan" values={['Divane Lounge', 'Divane Mey', 'Barney Pub']} onPick={setVenue} />)}
                {!needsMedia && <Field label="Başlık" value={title} onChangeText={setTitle} />}
                {needsMedia && <Field label="Açıklama" value={description} onChangeText={setDescription} multiline />}
                {needsMedia && <MediaPickerInline media={media} onPick={setMedia} onUploadMedia={onUploadMedia} aspectMode={mode === 'story' ? 'story' : 'post'} />}
              </>
            )}
            <PrimaryButton label={publishLabel} onPress={() => {
              if (isStaff) {
                if (!staffDraft.name.trim() || !staffDraft.id.trim() || !staffDraft.password.trim()) {
                  Alert.alert('Eksik bilgi', 'Personel adı, ID ve şifre zorunlu.');
                  return;
                }
                setPendingStaff({ ...staffDraft, id: staffDraft.id.trim(), name: staffDraft.name.trim(), password: staffDraft.password.trim() });
                return;
              }
              if (needsMedia && !media) {
                Alert.alert('Medya seç', 'Yayınlamak için telefondan bir fotoğraf veya video seçmelisin.');
                return;
              }
              onCreate(mode, { venue: allowedVenueId ? venueNameFromId(allowedVenueId) : venue, title, description, image: media });
              Alert.alert('Kaydedildi', mode === 'story' ? 'Story işletme halkasına eklendi.' : mode === 'post' ? 'Gönderi ana akışa eklendi.' : 'Kayıt panele eklendi.');
              onClose();
            }} />
            {pendingStaff && (
              <View style={styles.messageComposerCard}>
                <Text style={styles.panelTitle}>Personel hesabı oluşturulsun mu?</Text>
                <Text style={styles.helper}>{pendingStaff.name} · {pendingStaff.id} · {allowedVenueId ? venueNameFromId(allowedVenueId) : pendingStaff.venue}</Text>
                <Text style={styles.helper}>Rol: {pendingStaff.role}</Text>
                <View style={styles.confirmActions}>
                  <Pressable style={styles.confirmCancel} onPress={() => setPendingStaff(null)}><Text style={styles.confirmCancelText}>Vazgeç</Text></Pressable>
                  <Pressable style={styles.confirmButton} onPress={() => {
                    onCreate('staff', pendingStaff);
                    Alert.alert('Personel eklendi', `${pendingStaff.name} için giriş ID ve şifre hazırlandı.`);
                    setPendingStaff(null);
                    onClose();
                  }}><Text style={styles.confirmButtonText}>Oluştur</Text></Pressable>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function MediaPickerInline({ media, onPick, onUploadMedia, aspectMode = 'post' }) {
  const [localMedia, setLocalMedia] = useState(media);
  const [uploadProgress, setUploadProgress] = useState(media ? 100 : 0);
  const targetAspect = aspectMode === 'story' ? [9, 11] : [1, 1];
  const targetLabel = aspectMode === 'story' ? '9:11 dikey' : '1:1 kare';
  useEffect(() => {
    setLocalMedia(media);
    setUploadProgress(media ? 100 : 0);
  }, [media]);
  const pickMedia = async (kind = 'image') => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Fotoğraf izni gerekli', 'Story ve gönderi eklemek için fotoğraf arşivine erişim ver.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === 'video' ? ['videos'] : ['images'],
      allowsEditing: kind === 'image',
      aspect: targetAspect,
      base64: false,
      quality: 0.9,
      videoMaxDuration: 45,
      videoExportPreset: kind === 'video' ? ImagePicker.VideoExportPreset.H264_1280x720 : undefined,
    });
    if (!result.canceled && result.assets?.[0]) {
      const asset = result.assets[0];
      const type = asset.type || 'image';
      const uri = asset.uri;
      const ratio = asset.width && asset.height ? asset.width / asset.height : targetAspect[0] / targetAspect[1];
      const targetRatio = targetAspect[0] / targetAspect[1];
      const needsFrameCrop = Math.abs(ratio - targetRatio) > 0.04;
      const pendingMedia = { uri, localUri: asset.uri, type, fileName: asset.fileName || 'telefon-medya', mimeType: asset.mimeType, width: asset.width, height: asset.height, targetAspect: targetLabel, needsFrameCrop, uploadedAt: new Date().toISOString() };
      setLocalMedia(pendingMedia);
      setUploadProgress(0);
      for (const progress of [12, 28, 44, 63, 81]) {
        await wait(120);
        setUploadProgress(progress);
      }
      const servedMedia = onUploadMedia ? await onUploadMedia(pendingMedia) : pendingMedia;
      if (servedMedia?.uploadFailed) {
        setUploadProgress(0);
        setLocalMedia(null);
        Alert.alert('Yükleme başarısız', `${servedMedia.error || 'Video/fotoğraf servise yüklenemedi.'}\n\nMac tarafında demo server açık olmalı; aksi halde müşteri tarafına yayınlanamaz.`);
        return;
      }
      setLocalMedia(servedMedia);
      setUploadProgress(100);
      onPick(servedMedia);
    }
  };
  const visibleMedia = localMedia || media;
  return (
    <View style={styles.mediaPicker}>
      <Text style={styles.fieldLabel}>Telefondan fotoğraf / video seç</Text>
      <Text style={styles.helper}>{aspectMode === 'story' ? 'Story formatı 9:11 dikeydir. Fotoğraflar bu oranda kırpılır; videolar aynı oranda kapak önizlemesiyle çerçevelenir.' : 'Gönderi formatı 1:1 karedir. Fotoğraflar bu oranda kırpılır; videolar kare akış önizlemesiyle çerçevelenir.'}</Text>
      <View style={styles.mediaButtons}>
        <Pressable style={[styles.mediaButton, styles.flex]} onPress={() => pickMedia('image')}>
          <Text style={styles.mediaButtonText}>{visibleMedia && !isVideoMedia(visibleMedia) ? 'Fotoğrafı Değiştir' : 'Fotoğraf Seç'}</Text>
        </Pressable>
        <Pressable style={[styles.mediaButton, styles.flex]} onPress={() => pickMedia('video')}>
          <Text style={styles.mediaButtonText}>{visibleMedia && isVideoMedia(visibleMedia) ? 'Videoyu Değiştir' : 'Video Seç'}</Text>
        </Pressable>
      </View>
      <MediaPreview media={visibleMedia} style={[styles.mediaPreview, aspectMode === 'story' && styles.mediaPreviewStory]} />
      {visibleMedia && uploadProgress < 100 && (
        <View style={styles.uploadBox}>
          <View style={styles.uploadTrack}><View style={[styles.uploadFill, { width: `${uploadProgress}%` }]} /></View>
          <Text style={styles.mediaSelected}>Yükleniyor %{uploadProgress}</Text>
        </View>
      )}
      <Text style={styles.mediaSelected}>{visibleMedia ? uploadProgress === 100 ? `${isVideoMedia(visibleMedia) ? 'Video' : 'Fotoğraf'} servise eklendi · ${visibleMedia.targetAspect || targetLabel}${visibleMedia.needsFrameCrop ? ' · önizleme çerçevesi uygulanıyor' : ''}` : 'Medya servise yükleniyor' : 'Henüz medya seçilmedi'}</Text>
    </View>
  );
}

function getMediaUri(media) {
  if (typeof media === 'string') return media;
  if (media?.id && media?.remote) return `${API_BASE_URL}/api/media/${media.id}`;
  return media?.remoteUri || media?.uri;
}

function isVideoMedia(media) {
  if (!media) return false;
  if (typeof media === 'object') return media.type === 'video';
  return /\.(mp4|mov|m4v|webm)(\?|$)/i.test(media);
}

const MediaPreview = memo(function MediaPreview({ media, style, dark, storyMode = false, autoPlay, muted }) {
  const uri = getMediaUri(media);
  if (!uri) {
    return (
      <View style={[style, styles.mediaEmpty, dark && styles.mediaEmptyDark]}>
        <Text style={[styles.mediaEmptyText, dark && styles.mediaEmptyTextDark]}>Medya bekleniyor</Text>
      </View>
    );
  }
  if (isVideoMedia(media)) {
    return <VideoMediaPreview uri={uri} style={style} storyMode={storyMode} autoPlay={autoPlay ?? storyMode} muted={muted} />;
  }
  return <Image source={{ uri }} style={style} resizeMode="cover" resizeMethod="resize" fadeDuration={120} />;
});

const VideoMediaPreview = memo(function VideoMediaPreview({ uri, style, storyMode = false, autoPlay = false, muted }) {
  const [localMuted, setLocalMuted] = useState(false);
  const effectiveMuted = muted ?? localMuted;
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = Boolean(effectiveMuted);
    instance.audioMixingMode = 'auto';
    if (autoPlay) instance.play();
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  useEffect(() => {
    player.muted = Boolean(effectiveMuted);
  }, [player, effectiveMuted]);
  const togglePlayback = () => {
    if (isPlaying) {
      player.pause();
    } else {
      player.muted = Boolean(effectiveMuted);
      player.play();
    }
  };
  return (
    <View style={[style, styles.videoPreview]}>
      <VideoView
        style={styles.videoPlayer}
        player={player}
        nativeControls={!storyMode}
        fullscreenOptions={{ enable: !storyMode }}
        allowsPictureInPicture
        contentFit="cover"
        surfaceType="textureView"
      />
      {!isPlaying && (
        <Pressable style={styles.videoOverlay} onPress={togglePlayback}>
          <Text style={styles.videoPlay}>▶</Text>
          <Text style={styles.videoText}>Oynat</Text>
        </Pressable>
      )}
      {!storyMode && (
        <Pressable style={styles.videoSoundButton} onPress={() => setLocalMuted((current) => !current)}>
          <Text style={styles.videoSoundText}>{effectiveMuted ? 'Sesi Aç' : 'Sesi Kapat'}</Text>
        </Pressable>
      )}
    </View>
  );
});

function sampleValue(field, index) {
  const values = {
    'Ad Soyad': 'Ada Demir',
    Telefon: '5551112233',
    'Üyelik seviyesi': 'Gold Member',
    'Son giriş': 'Divane Lounge · Dün 23.18',
    Mekan: venues[(index % 3) + 1]?.name || 'Divane Lounge',
    'Story başlığı': 'Weekend Party',
    '12 saatlik yayın süresi': 'Aktif · 11:25 kaldı',
    'Kapak görseli': 'story-weekend-party.jpg',
    'Gönderi açıklaması': 'Premium booth ve mavi cam ışıklar',
    'CTA butonu': 'Rezervasyon Yap',
    '1:1 görsel / reels kapağı': 'feed-afro-house.jpg',
    'Atanmış ID': 'PRS-312',
    Rol: 'Personel',
    'Geçici şifre': '1234',
  };
  return values[field] || 'Örnek veri';
}

const MetricGrid = memo(function MetricGrid({ items }) {
  return (
    <View style={styles.metricGrid}>
      {items.map(([label, value]) => (
        <View key={label} style={styles.metricCard}>
          <Text style={styles.metricValue}>{value}</Text>
          <Text style={styles.metricLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
});

function HeroPanel({ title, subtitle, stat, statLabel }) {
  return (
    <View style={styles.heroCard}>
      <View style={styles.flex}>
        <Text style={styles.eyebrow}>{subtitle}</Text>
        <Text style={styles.heroTitle}>{title}</Text>
      </View>
      <View style={styles.statOrb}>
        <Text style={styles.statOrbValue}>{stat}</Text>
        <Text style={styles.statOrbLabel}>{statLabel}</Text>
      </View>
    </View>
  );
}

function PickerRow({ label, values, onPick, initialValue }) {
  const isDark = useDarkMode();
  const [selected, setSelected] = useState(initialValue || values[0]);
  return (
    <View style={styles.pickerBlock}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pickerRow}>
        {values.map((value) => (
          <Pressable key={value} onPress={() => { setSelected(value); onPick?.(value); }} style={[styles.pickerPill, isDark && styles.pickerPillDark, selected === value && styles.pickerPillActive]}>
            <Text style={[styles.pickerText, isDark && styles.pickerTextDark, selected === value && styles.pickerTextActive]}>{value}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const GlassPanel = memo(function GlassPanel({ children }) {
  return <View style={styles.glassPanel}>{children}</View>;
});

const GlassListCard = memo(function GlassListCard({ title, meta, right }) {
  return (
    <View style={styles.listCard}>
      <View style={styles.listCardText}>
        <Text style={styles.listTitle} numberOfLines={2}>{title}</Text>
        <Text style={styles.listMeta} numberOfLines={3}>{meta}</Text>
      </View>
      <Text style={styles.statusBadge} numberOfLines={2}>{right}</Text>
    </View>
  );
});

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function Bar({ label, value, max }) {
  return (
    <View style={styles.barBlock}>
      <View style={styles.barHeader}><Text style={styles.barLabel}>{label}</Text><Text style={styles.barValue}>{value}</Text></View>
      <View style={styles.barTrack}><View style={[styles.barFill, { width: `${Math.min(100, (value / max) * 100)}%` }]} /></View>
    </View>
  );
}

function MiniBars({ values }) {
  const max = Math.max(...values);
  return (
    <View style={styles.miniBars}>
      {values.map((value, index) => <View key={`${value}-${index}`} style={[styles.miniBar, { height: 42 + (value / max) * 104 }]}><Text style={styles.miniBarText}>{value}</Text></View>)}
    </View>
  );
}

function ProgressBar({ value }) {
  return <View style={styles.barTrack}><View style={[styles.barFill, { width: `${value}%` }]} /></View>;
}

const QrPattern = memo(function QrPattern({ compact, value = 'DS-CHECKIN:5551112233:1' }) {
  const matrix = useMemo(() => {
    const qrcode = new QRCode(-1, QRErrorCorrectLevel.M);
    qrcode.addData(value);
    qrcode.make();
    const quietZone = 4;
    const count = qrcode.getModuleCount();
    return Array.from({ length: count + quietZone * 2 }, (_, row) => (
      Array.from({ length: count + quietZone * 2 }, (_, col) => {
        const sourceRow = row - quietZone;
        const sourceCol = col - quietZone;
        if (sourceRow < 0 || sourceCol < 0 || sourceRow >= count || sourceCol >= count) return false;
        return qrcode.isDark(sourceRow, sourceCol);
      })
    ));
  }, [value]);
  const cellSize = compact ? 4 : 7;
  const boxSize = matrix.length * cellSize;
  return (
    <View style={[styles.qrPattern, compact && styles.qrPatternCompact, { width: boxSize, height: boxSize }]}>
      {matrix.map((row, rowIndex) => row.map((dark, colIndex) => (
        <View key={`${rowIndex}-${colIndex}`} style={[styles.qrCell, { width: cellSize, height: cellSize }, dark && styles.qrCellDark]} />
      )))}
    </View>
  );
});

function Field({ label, multiline, ...props }) {
  const isDark = useDarkMode();
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput {...props} multiline={multiline} placeholderTextColor={isDark ? '#9BA8B7' : '#8A97A8'} style={[styles.input, isDark && styles.inputDark, multiline && styles.textArea]} />
    </View>
  );
}

function PrimaryButton({ label, onPress }) {
  return <Pressable onPress={onPress} style={styles.primaryButton}><Text style={styles.primaryText} numberOfLines={2}>{label}</Text></Pressable>;
}

function SecondaryButton({ label, onPress }) {
  return <Pressable onPress={onPress} style={styles.secondaryButton}><Text style={styles.secondaryText} numberOfLines={2}>{label}</Text></Pressable>;
}

function SectionTitle({ title, action }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionTitle} numberOfLines={2}>{title}</Text><Text style={styles.sectionAction} numberOfLines={1}>{action}</Text></View>;
}

const BrandLogo = memo(function BrandLogo({ compact }) {
  return <Image source={societyIcon} style={[styles.societyLogoImage, compact && styles.societyLogoImageCompact]} resizeMode="contain" />;
});

function Ambient({ dark }) {
  return (
    <View pointerEvents="none" style={[styles.ambient, dark && styles.ambientDark]}>
      <View style={[styles.glow, styles.glowOne, dark && styles.glowOneDark]} />
      <View style={[styles.glow, styles.glowTwo, dark && styles.glowTwoDark]} />
      <View style={[styles.glow, styles.glowThree, dark && styles.glowThreeDark]} />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1, backgroundColor: '#F7FAFE', paddingTop: ROOT_TOP_PADDING },
  appDark: { backgroundColor: '#070B12' },
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 },
  ambient: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  ambientDark: { backgroundColor: '#070B12' },
  glow: { position: 'absolute', borderRadius: 999, opacity: 0.56 },
  glowOne: { width: 260, height: 260, backgroundColor: '#D9ECFF', top: -70, right: -70 },
  glowTwo: { width: 220, height: 220, backgroundColor: '#F7EAF5', top: 240, left: -100 },
  glowThree: { width: 280, height: 280, backgroundColor: '#E9F5FF', bottom: -120, right: -80 },
  glowOneDark: { backgroundColor: 'rgba(159,201,243,.30)', opacity: 0.72 },
  glowTwoDark: { backgroundColor: 'rgba(116,92,255,.20)', opacity: 0.62 },
  glowThreeDark: { backgroundColor: 'rgba(255,255,255,.10)', opacity: 0.55 },
  loadingText: { color: '#4B5E75', fontWeight: '800', fontSize: 18 },
  loadingTextDark: { color: 'rgba(255,255,255,.82)' },
  authContent: { padding: 20, paddingBottom: 36, gap: 16 },
  authHero: { paddingTop: 12, gap: 12 },
  authTitle: { color: '#101827', fontSize: 42, fontWeight: '900', letterSpacing: 0 },
  authTitleDark: { color: '#F8FBFF' },
  authLead: { color: '#52657A', fontSize: 17, lineHeight: 25, fontWeight: '600' },
  authLeadDark: { color: 'rgba(238,245,255,.78)' },
  logoWindow: { minWidth: 220, height: 58, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.72)', borderWidth: 1, borderColor: 'rgba(159,201,243,.55)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  logoWindowCompact: { minWidth: 96, height: 34, borderRadius: 12, paddingHorizontal: 10 },
  wordLogo: { color: '#111827', fontSize: 28, fontWeight: '900', letterSpacing: 0 },
  wordLogoCompact: { fontSize: 19 },
  societyLogoImage: { width: 112, height: 112, borderRadius: 28 },
  societyLogoImageCompact: { width: 42, height: 42, borderRadius: 12 },
  glassPanel: {
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,.86)',
    backgroundColor: 'rgba(255,255,255,.66)',
    padding: 18,
    gap: 14,
    shadowColor: '#7FB9EC',
    shadowOpacity: 0.16,
    shadowOffset: { width: 0, height: 18 },
    shadowRadius: 22,
    elevation: 2,
  },
  eyebrow: { color: '#5B97CA', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0 },
  eyebrowDark: { color: '#9FC9F3' },
  panelTitle: { color: '#111827', fontSize: 25, fontWeight: '900', letterSpacing: 0 },
  helper: { color: '#5F7186', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  bodyText: { color: '#263447', fontSize: 16, fontWeight: '800' },
  authSwitch: { flexDirection: 'row', gap: 8, padding: 6, borderRadius: 22, backgroundColor: 'rgba(159,201,243,.18)' },
  authSwitchDark: { backgroundColor: 'rgba(16,24,39,.10)' },
  authSwitchButton: { flex: 1, minHeight: 44, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  authSwitchButtonActive: { backgroundColor: '#FFFFFF', shadowColor: BLUE, shadowOpacity: .25, shadowRadius: 12 },
  authSwitchButtonActiveDark: { backgroundColor: 'rgba(255,255,255,.92)' },
  authSwitchText: { color: '#5F7186', fontSize: 15, fontWeight: '900' },
  authSwitchTextActive: { color: '#111827' },
  fieldWrap: { gap: 7 },
  fieldLabel: { color: '#34465D', fontSize: 14, fontWeight: '900' },
  input: { minHeight: 54, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(159,201,243,.72)', backgroundColor: 'rgba(255,255,255,.7)', paddingHorizontal: 16, color: '#111827', fontSize: 17, fontWeight: '700' },
  inputDark: { borderColor: 'rgba(159,201,243,.55)', backgroundColor: 'rgba(255,255,255,.84)' },
  textArea: { minHeight: 108, paddingTop: 14, textAlignVertical: 'top' },
  rememberRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 8, borderWidth: 1, borderColor: BLUE, backgroundColor: 'rgba(255,255,255,.7)' },
  checkboxActive: { backgroundColor: BLUE, shadowColor: BLUE, shadowOpacity: .55, shadowRadius: 12 },
  primaryButton: { minHeight: 56, borderRadius: 20, paddingHorizontal: 16, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', shadowColor: BLUE, shadowOpacity: .24, shadowRadius: 14 },
  primaryText: { color: '#FFFFFF', fontSize: 17, lineHeight: 21, fontWeight: '900', textAlign: 'center' },
  secondaryButton: { minHeight: 54, borderRadius: 20, paddingHorizontal: 16, borderWidth: 1, borderColor: 'rgba(159,201,243,.75)', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.54)' },
  secondaryText: { color: '#263447', fontSize: 16, lineHeight: 20, fontWeight: '900', textAlign: 'center' },
  topbar: { paddingHorizontal: 18, paddingTop: 8, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topbarDark: { backgroundColor: 'rgba(7,11,18,.68)' },
  topIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  topTextBlock: { flex: 1, minWidth: 0 },
  adminPlus: { width: 38, height: 38, borderRadius: 19, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center', shadowColor: BLUE, shadowOpacity: .35, shadowRadius: 12 },
  adminPlusText: { color: '#102033', fontSize: 26, fontWeight: '900', lineHeight: 28 },
  topTitle: { color: '#111827', fontSize: 19, fontWeight: '900' },
  topTitleDark: { color: '#F8FBFF' },
  logout: { paddingHorizontal: 14, minHeight: 42, borderRadius: 16, backgroundColor: 'rgba(255,255,255,.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', justifyContent: 'center' },
  logoutDark: { backgroundColor: 'rgba(255,255,255,.10)', borderColor: 'rgba(255,255,255,.18)' },
  logoutText: { color: '#263447', fontWeight: '900' },
  logoutTextDark: { color: '#F8FBFF' },
  bottomTabShell: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: SAFE_BOTTOM, backgroundColor: 'rgba(247,250,254,.72)' },
  bottomTabShellDark: { backgroundColor: 'rgba(7,11,18,.78)' },
  blurTabbar: { padding: 8, gap: 8, borderRadius: 24, backgroundColor: 'rgba(255,255,255,.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)' },
  blurTabbarDark: { backgroundColor: 'rgba(255,255,255,.10)', borderColor: 'rgba(255,255,255,.16)' },
  tab: { minHeight: 42, paddingHorizontal: 16, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  tabDark: { backgroundColor: 'rgba(255,255,255,.04)' },
  tabActive: { backgroundColor: 'rgba(159,201,243,.92)' },
  tabIcon: { color: '#52657A', fontSize: 18, fontWeight: '900', lineHeight: 20 },
  tabText: { color: '#52657A', fontSize: 14, fontWeight: '900' },
  tabTextDark: { color: 'rgba(238,245,255,.74)' },
  tabTextActive: { color: '#102033' },
  screenContent: { padding: 18, paddingBottom: 32, gap: 16 },
  heroCard: { minHeight: 186, borderRadius: 30, padding: 20, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 16, backgroundColor: 'rgba(255,255,255,.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', shadowColor: '#8CC7F5', shadowOpacity: .18, shadowOffset: { width: 0, height: 14 }, shadowRadius: 22 },
  homeStickyBlock: { gap: 14, borderRadius: 30, paddingBottom: 2 },
  homeLogoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  homeLogoText: { color: '#111827', fontSize: 24, fontWeight: '900' },
  brandStoryRow: { gap: 14, paddingVertical: 2 },
  brandStory: { width: 112, alignItems: 'center', gap: 6 },
  brandStoryRing: { width: 86, height: 86, borderRadius: 43, borderWidth: 3, padding: 7, backgroundColor: '#FFFFFF', shadowColor: BLUE, shadowOpacity: .35, shadowRadius: 14, alignItems: 'center', justifyContent: 'center' },
  brandStoryRingDark: { backgroundColor: '#101827' },
  brandStoryImage: { width: '100%', height: '100%', borderRadius: 36 },
  brandStoryLogo: { width: '100%', height: '100%', borderRadius: 36 },
  brandStoryText: { color: '#111827', fontSize: 13, fontWeight: '900', textAlign: 'center' },
  brandStoryCount: { color: '#5F7186', fontSize: 12, fontWeight: '800' },
  heroCopy: { flex: 1, minWidth: 190, gap: 8 },
  heroTitle: { color: '#111827', fontSize: 29, lineHeight: 34, fontWeight: '900', letterSpacing: 0 },
  heroText: { color: '#53687D', fontSize: 16, lineHeight: 23, fontWeight: '700' },
  heroAvatar: { width: 82, height: 82, borderRadius: 28, borderWidth: 3, borderColor: '#FFFFFF' },
  filterRow: { gap: 10 },
  filterPill: { minHeight: 42, paddingHorizontal: 16, borderRadius: 18, borderWidth: 1, borderColor: 'rgba(159,201,243,.55)', backgroundColor: 'rgba(255,255,255,.6)', alignItems: 'center', justifyContent: 'center' },
  filterPillActive: { backgroundColor: BLUE, borderColor: '#FFFFFF' },
  filterText: { color: '#51677E', fontWeight: '900' },
  filterTextActive: { color: '#101827' },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { color: '#101827', fontSize: 23, fontWeight: '900', flex: 1 },
  sectionAction: { color: '#4D94CD', fontWeight: '900', flexShrink: 0 },
  storyRow: { gap: 12 },
  storyBubble: { width: 136, height: 186, borderRadius: 28, overflow: 'hidden', borderWidth: 1, borderColor: 'rgba(255,255,255,.95)', backgroundColor: 'rgba(255,255,255,.62)', shadowColor: BLUE, shadowOpacity: .2, shadowRadius: 14 },
  storyThumb: { width: '100%', height: '100%' },
  storyGlassCap: { position: 'absolute', left: 8, right: 8, bottom: 8, padding: 10, borderRadius: 18, backgroundColor: 'rgba(255,255,255,.72)' },
  storyLabel: { color: '#4D94CD', fontWeight: '900', fontSize: 12 },
  storyTitle: { color: '#102033', fontWeight: '900', fontSize: 14, marginTop: 2 },
  postCard: { borderRadius: 30, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,.72)', borderWidth: 1, borderColor: 'rgba(255,255,255,.95)', shadowColor: '#8CC7F5', shadowOpacity: .13, shadowRadius: 18 },
  postHeader: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  postHeaderText: { flex: 1, minWidth: 0 },
  venueDot: { width: 46, height: 46, borderRadius: 18, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' },
  venueDotText: { color: '#102033', fontWeight: '900', fontSize: 18 },
  postVenue: { color: '#111827', fontSize: 17, fontWeight: '900' },
  postDate: { color: '#65778A', fontSize: 13, fontWeight: '800', marginTop: 2 },
  smallGlassButton: { minHeight: 38, maxWidth: 132, borderRadius: 16, paddingHorizontal: 12, backgroundColor: 'rgba(159,201,243,.55)', alignItems: 'center', justifyContent: 'center' },
  smallGlassButtonDone: { backgroundColor: 'rgba(137,216,194,.65)' },
  smallGlassText: { color: '#102033', fontWeight: '900', textAlign: 'center', lineHeight: 16 },
  postImage: { width: '100%', aspectRatio: 1 },
  reactionBar: { margin: 12, minHeight: 50, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.7)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14 },
  reactionIcon: { fontSize: 25, color: '#111827', fontWeight: '900' },
  liked: { color: '#F43F5E' },
  reactionCount: { marginLeft: 'auto', color: '#34465D', fontWeight: '900', flexShrink: 1, textAlign: 'right' },
  postBody: { paddingHorizontal: 16, paddingBottom: 16, gap: 8 },
  postTitle: { color: '#111827', fontSize: 21, fontWeight: '900' },
  postText: { color: '#53687D', fontSize: 16, lineHeight: 23, fontWeight: '700' },
  commentText: { color: '#4B5E75', fontSize: 15, lineHeight: 21, fontWeight: '700' },
  commentAuthor: { color: '#111827', fontWeight: '900' },
  commentComposer: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44, borderTopWidth: 1, borderTopColor: 'rgba(159,201,243,.32)', marginTop: 4 },
  commentInput: { flex: 1, color: '#111827', fontSize: 15, fontWeight: '700' },
  sendText: { color: '#4D94CD', fontWeight: '900' },
  storyModal: { flex: 1, backgroundColor: '#000' },
  storyTapArea: { ...StyleSheet.absoluteFillObject },
  storyTapZones: { position: 'absolute', left: 0, right: 0, top: SAFE_TOP + 78, bottom: SAFE_BOTTOM + 150, flexDirection: 'row', zIndex: 1 },
  storyTapZone: { flex: 1 },
  storyModalImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  storyShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,.26)' },
  storyProgressStack: { position: 'absolute', top: SAFE_TOP + 10, left: 16, right: 16, height: 4, flexDirection: 'row', gap: 5, zIndex: 5 },
  storyProgressSegment: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,.35)' },
  storyProgressFill: { height: '100%', backgroundColor: '#FFFFFF', borderRadius: 2 },
  storyModalHeader: { position: 'absolute', top: SAFE_TOP + 24, left: 16, right: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, zIndex: 4 },
  storyModalTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', flex: 1 },
  storySoundButton: { position: 'absolute', top: SAFE_TOP + 78, right: 16, zIndex: 7, minHeight: 38, borderRadius: 19, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.9)', borderWidth: 1, borderColor: 'rgba(255,255,255,.96)' },
  storySoundText: { color: '#111827', fontSize: 12, fontWeight: '900' },
  closeButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.22)', alignItems: 'center', justifyContent: 'center' },
  closeText: { color: '#FFFFFF', fontSize: 32, lineHeight: 34 },
  storyBottom: { position: 'absolute', left: 16, right: 16, bottom: SAFE_BOTTOM + 12, gap: 10, zIndex: 4 },
  storyCaption: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  storyComment: { color: '#FFFFFF', alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,.2)', overflow: 'hidden', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, fontWeight: '800' },
  storyCommentAuthor: { fontWeight: '900', color: '#FFFFFF' },
  storyActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  roundAction: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.22)' },
  roundActionText: { color: '#FFFFFF', fontSize: 27 },
  storyInput: { flex: 1, minWidth: 0, minHeight: 46, borderRadius: 23, borderWidth: 1, borderColor: 'rgba(255,255,255,.52)', paddingHorizontal: 14, color: '#FFFFFF', fontWeight: '800' },
  storySend: { minHeight: 46, borderRadius: 23, backgroundColor: '#FFFFFF', paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  storySendText: { color: '#111827', fontWeight: '900' },
  qrShell: { alignSelf: 'center', width: 236, height: 236, borderRadius: 34, backgroundColor: 'rgba(255,255,255,.76)', borderWidth: 1, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', shadowColor: BLUE, shadowOpacity: .34, shadowRadius: 22 },
  qrGlow: { position: 'absolute', width: 150, height: 150, borderRadius: 75, backgroundColor: 'rgba(159,201,243,.16)' },
  qrPattern: { borderRadius: 18, flexDirection: 'row', flexWrap: 'wrap', backgroundColor: '#FFFFFF', overflow: 'hidden' },
  qrPatternCompact: { alignSelf: 'center', borderRadius: 12 },
  qrCell: { backgroundColor: '#F2F7FC' },
  qrCellDark: { backgroundColor: '#111827' },
  loyaltyCard: { borderRadius: 30, padding: 20, minHeight: 230, backgroundColor: '#111827', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)', shadowColor: BLUE, shadowOpacity: .25, shadowRadius: 20, gap: 18 },
  loyaltyCardTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  loyaltyCardEyebrow: { color: BLUE, fontSize: 13, fontWeight: '900', textTransform: 'uppercase' },
  loyaltyCardTitle: { color: '#FFFFFF', fontSize: 30, fontWeight: '900', marginTop: 4 },
  loyaltyCardNumber: { color: 'rgba(255,255,255,.7)', fontSize: 14, fontWeight: '900' },
  loyaltyCardMiddle: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 14 },
  loyaltyCardLabel: { color: '#FFFFFF', fontSize: 22, fontWeight: '900' },
  loyaltyCardSub: { color: 'rgba(255,255,255,.72)', fontSize: 15, fontWeight: '800', marginTop: 6 },
  loyaltyStampRow: { flexDirection: 'row', gap: 8 },
  loyaltyStamp: { flex: 1, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,.28)' },
  loyaltyStampActive: { backgroundColor: BLUE },
  loyaltyStampText: { color: '#102033', fontWeight: '900' },
  wheelShell: { alignSelf: 'center', width: '100%', maxWidth: 310, height: 310, alignItems: 'center', justifyContent: 'center' },
  wheelPointer: { position: 'absolute', top: 0, zIndex: 3, width: 42, height: 42, borderRadius: 21, backgroundColor: '#C8943B', alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF' },
  wheelPointerText: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', lineHeight: 22 },
  wheel: { width: 276, height: 276, borderRadius: 138, alignSelf: 'center', backgroundColor: '#FFFFFF', borderWidth: 10, borderColor: '#C8943B', alignItems: 'center', justifyContent: 'center', shadowColor: '#C8943B', shadowOpacity: .26, shadowRadius: 18, overflow: 'hidden' },
  wheelLocked: { opacity: .52 },
  wheelSegmentFill: { position: 'absolute', borderRadius: 34, backgroundColor: 'rgba(159,201,243,.20)', borderWidth: 1, borderColor: 'rgba(200,148,59,.18)' },
  wheelSegmentFillAlt: { backgroundColor: 'rgba(200,148,59,.17)' },
  wheelSpoke: { position: 'absolute', width: 3, height: 258, backgroundColor: 'rgba(200,148,59,.68)' },
  wheelPrizeSlot: { position: 'absolute', borderRadius: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 7, backgroundColor: 'rgba(255,255,255,.72)', borderWidth: 1, borderColor: 'rgba(200,148,59,.55)' },
  wheelPrizeSlotAlt: { backgroundColor: 'rgba(255,249,237,.78)' },
  wheelItem: { color: '#102033', fontSize: 11, lineHeight: 14, fontWeight: '900', textAlign: 'center' },
  wheelCore: { width: 86, height: 86, borderRadius: 43, backgroundColor: '#111827', alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#C8943B' },
  wheelCoreText: { color: '#FFFFFF', fontSize: 18, fontWeight: '900' },
  bigWin: { color: '#111827', fontSize: 30, fontWeight: '900' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { flexGrow: 1, minWidth: '30%', borderRadius: 22, padding: 14, backgroundColor: 'rgba(255,255,255,.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)' },
  metricValue: { color: '#111827', fontSize: 24, fontWeight: '900' },
  metricLabel: { color: '#5E7186', fontSize: 13, fontWeight: '900', marginTop: 6 },
  listCard: { minHeight: 72, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12, padding: 14, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,.88)' },
  listCardText: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  editableRow: { minHeight: 82, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,.62)', borderWidth: 1, borderColor: 'rgba(255,255,255,.88)' },
  editableRowText: { flexGrow: 1, flexShrink: 1, minWidth: 180 },
  swipeShell: { position: 'relative', marginBottom: 8, overflow: 'hidden', borderRadius: 22 },
  swipeContent: { transform: [{ translateX: 0 }] },
  swipeContentRevealed: { transform: [{ translateX: -76 }] },
  swipeDelete: { position: 'absolute', right: 0, top: 0, bottom: 0, width: 82, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F04438' },
  swipeDeleteText: { color: '#FFFFFF', fontWeight: '900' },
  rewardQrRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 22, marginBottom: 10, backgroundColor: 'rgba(255,255,255,.66)', borderWidth: 1, borderColor: 'rgba(159,201,243,.34)' },
  rewardQrText: { flex: 1, minWidth: 0 },
  messageComposerCard: { borderRadius: 22, padding: 14, gap: 12, backgroundColor: 'rgba(159,201,243,.16)', borderWidth: 1, borderColor: 'rgba(159,201,243,.42)' },
  rowAction: { minHeight: 36, minWidth: 70, borderRadius: 14, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(159,201,243,.36)' },
  rowDelete: { backgroundColor: 'rgba(244,63,94,.12)' },
  rowActionText: { color: '#285C87', fontWeight: '900', fontSize: 12 },
  rowDeleteText: { color: '#BE123C', fontWeight: '900', fontSize: 12 },
  listTitle: { color: '#111827', fontSize: 17, fontWeight: '900' },
  listMeta: { color: '#5F7186', marginTop: 4, fontWeight: '700' },
  statusBadge: { color: '#285C87', backgroundColor: 'rgba(159,201,243,.38)', overflow: 'hidden', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7, fontWeight: '900', maxWidth: 150, textAlign: 'center', flexShrink: 1 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 12, borderTopWidth: 1, borderTopColor: 'rgba(159,201,243,.3)', paddingTop: 12 },
  infoLabel: { color: '#5F7186', fontWeight: '800', flex: 1 },
  infoValue: { color: '#111827', fontWeight: '900', flex: 1.2, textAlign: 'right' },
  barBlock: { gap: 8 },
  barHeader: { flexDirection: 'row', justifyContent: 'space-between' },
  barLabel: { color: '#34465D', fontSize: 15, fontWeight: '900' },
  barValue: { color: '#4D94CD', fontSize: 15, fontWeight: '900' },
  barTrack: { height: 13, borderRadius: 7, backgroundColor: 'rgba(159,201,243,.2)', overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: BLUE, borderRadius: 7 },
  miniBars: { height: 176, flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  miniBar: { flex: 1, borderRadius: 16, backgroundColor: 'rgba(159,201,243,.72)', alignItems: 'center', justifyContent: 'flex-end', paddingBottom: 8 },
  miniBarText: { color: '#102033', fontSize: 11, fontWeight: '900' },
  pickerBlock: { gap: 8 },
  pickerRow: { gap: 8 },
  pickerPill: { minHeight: 42, borderRadius: 18, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.58)', borderWidth: 1, borderColor: 'rgba(159,201,243,.42)' },
  pickerPillDark: { backgroundColor: 'rgba(255,255,255,.74)', borderColor: 'rgba(159,201,243,.38)' },
  pickerPillActive: { backgroundColor: BLUE, borderColor: '#FFFFFF' },
  pickerText: { color: '#53687D', fontWeight: '900' },
  pickerTextDark: { color: '#34465D' },
  pickerTextActive: { color: '#102033' },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  profileTextBlock: { flex: 1, minWidth: 0 },
  profilePhotoShell: { width: 88, height: 88, borderRadius: 30, overflow: 'hidden', borderWidth: 3, borderColor: '#FFFFFF', backgroundColor: 'rgba(255,255,255,.7)' },
  profilePhoto: { width: '100%', height: '100%' },
  profilePhotoEdit: { position: 'absolute', left: 6, right: 6, bottom: 6, minHeight: 24, borderRadius: 12, overflow: 'hidden', textAlign: 'center', textAlignVertical: 'center', backgroundColor: 'rgba(16,24,39,.72)', color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  scanFrame: { minHeight: 230, borderRadius: 28, backgroundColor: 'rgba(255,255,255,.6)', alignItems: 'center', justifyContent: 'center', gap: 12, borderWidth: 1, borderColor: '#FFFFFF' },
  cameraFrame: { minHeight: 300, borderRadius: 30, backgroundColor: '#101827', overflow: 'hidden', alignItems: 'center', justifyContent: 'center', gap: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.9)' },
  cameraPreview: { ...StyleSheet.absoluteFillObject },
  cameraPermissionPane: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#101827' },
  cameraPermissionTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '900', textAlign: 'center' },
  cameraPermissionText: { color: 'rgba(255,255,255,.72)', fontSize: 15, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  cameraTopBar: { position: 'absolute', top: 14, left: 14, right: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cameraLive: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  cameraLiveMuted: { color: 'rgba(255,255,255,.62)', fontSize: 13, fontWeight: '800' },
  scanReticle: { width: 184, height: 184, borderRadius: 28, borderWidth: 3, borderColor: BLUE, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.12)' },
  scanReticleText: { color: '#FFFFFF', fontSize: 32, fontWeight: '900' },
  scanHint: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', backgroundColor: 'rgba(16,24,39,.55)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, overflow: 'hidden' },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  modulePill: { minHeight: 42, borderRadius: 18, paddingHorizontal: 12, justifyContent: 'center', backgroundColor: 'rgba(159,201,243,.32)', borderWidth: 1, borderColor: 'rgba(255,255,255,.9)' },
  moduleText: { color: '#24384F', fontWeight: '900' },
  creationGrid: { gap: 10 },
  creationField: { borderRadius: 18, padding: 13, backgroundColor: 'rgba(255,255,255,.58)', borderWidth: 1, borderColor: 'rgba(159,201,243,.32)' },
  creationValue: { color: '#111827', fontSize: 16, fontWeight: '900', marginTop: 5 },
  mediaModalOverlay: { flex: 1, justifyContent: 'flex-end', paddingTop: SAFE_TOP, backgroundColor: 'rgba(16,24,39,.22)' },
  mediaModalCard: { maxHeight: '92%', borderTopLeftRadius: 30, borderTopRightRadius: 30, backgroundColor: 'rgba(247,250,254,.98)', borderWidth: 1, borderColor: '#FFFFFF', overflow: 'hidden' },
  mediaModalContent: { padding: 18, gap: 14, paddingBottom: SAFE_BOTTOM + 34 },
  mediaModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  confirmOverlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18, paddingTop: SAFE_TOP + 12, paddingBottom: SAFE_BOTTOM + 12, backgroundColor: 'rgba(16,24,39,.24)' },
  confirmCard: { width: '100%', maxWidth: 560, maxHeight: '100%', borderRadius: 28, padding: 18, backgroundColor: 'rgba(247,250,254,.98)', borderWidth: 1, borderColor: '#FFFFFF' },
  confirmScrollContent: { gap: 14, paddingBottom: 2 },
  confirmActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  confirmCancel: { flex: 1, minHeight: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.8)', borderWidth: 1, borderColor: 'rgba(159,201,243,.35)' },
  confirmButton: { flex: 1, minHeight: 50, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111827' },
  confirmCancelText: { color: '#34465D', fontWeight: '900' },
  confirmButtonText: { color: '#FFFFFF', fontWeight: '900' },
  inAppBanner: { position: 'absolute', top: SAFE_TOP + 8, left: 16, right: 16, zIndex: 20, minHeight: 78, borderRadius: 24, padding: 15, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,.94)', borderWidth: 1, borderColor: 'rgba(255,255,255,.98)', shadowColor: BLUE, shadowOpacity: .24, shadowRadius: 18 },
  inAppBannerDark: { backgroundColor: 'rgba(15,23,42,.96)', borderColor: 'rgba(159,201,243,.26)' },
  inAppBannerGlow: { position: 'absolute', width: 120, height: 120, borderRadius: 60, right: -30, top: -40, backgroundColor: 'rgba(159,201,243,.42)' },
  inAppBannerTitle: { color: '#111827', fontSize: 16, fontWeight: '900' },
  inAppBannerTitleDark: { color: '#F8FBFF' },
  inAppBannerText: { color: '#52657A', fontSize: 14, lineHeight: 19, fontWeight: '800', marginTop: 4 },
  inAppBannerTextDark: { color: 'rgba(238,245,255,.78)' },
  mediaClose: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(159,201,243,.24)' },
  closeLite: { color: '#111827', fontSize: 30, lineHeight: 32, fontWeight: '800' },
  mediaPicker: { borderRadius: 20, padding: 14, gap: 10, backgroundColor: 'rgba(255,255,255,.62)', borderWidth: 1, borderColor: 'rgba(159,201,243,.36)' },
  mediaButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mediaButton: { minHeight: 46, minWidth: 130, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(159,201,243,.45)' },
  mediaButtonText: { color: '#102033', fontWeight: '900', textAlign: 'center' },
  mediaSelected: { color: '#5F7186', fontWeight: '800' },
  uploadBox: { gap: 7 },
  uploadTrack: { height: 10, borderRadius: 5, backgroundColor: 'rgba(159,201,243,.22)', overflow: 'hidden' },
  uploadFill: { height: '100%', borderRadius: 5, backgroundColor: BLUE },
  mediaPreview: { width: '100%', aspectRatio: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: 'rgba(16,24,39,.08)' },
  mediaPreviewStory: { aspectRatio: 9 / 11, maxHeight: 430, alignSelf: 'center' },
  mediaEmpty: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(159,201,243,.14)' },
  mediaEmptyDark: { backgroundColor: '#101827' },
  mediaEmptyText: { color: '#5F7186', fontWeight: '900' },
  mediaEmptyTextDark: { color: '#FFFFFF' },
  videoPreview: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#101827' },
  videoPlayer: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  videoOverlay: { position: 'absolute', left: 14, bottom: 14, minHeight: 42, borderRadius: 21, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(16,24,39,.58)' },
  videoPlay: { color: '#FFFFFF', fontSize: 42, fontWeight: '900' },
  videoText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900' },
  videoSoundButton: { position: 'absolute', top: 12, right: 12, minHeight: 36, borderRadius: 18, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.88)', borderWidth: 1, borderColor: 'rgba(255,255,255,.95)' },
  videoSoundText: { color: '#111827', fontSize: 12, fontWeight: '900' },
  statOrb: { width: 118, height: 118, borderRadius: 38, backgroundColor: 'rgba(159,201,243,.58)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFFFFF' },
  statOrbValue: { color: '#102033', fontSize: 25, fontWeight: '900' },
  statOrbLabel: { color: '#48627C', fontSize: 12, fontWeight: '900', textAlign: 'center', marginTop: 4 },
});
