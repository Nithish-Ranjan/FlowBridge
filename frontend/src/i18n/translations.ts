import { createContext, useContext, useState, type ReactNode } from 'react';

export type LanguageCode = 'en' | 'kn' | 'hi';

export interface TranslationDictionary {
  appName: string;
  tagline: string;
  // Navigation
  navDashboard: string;
  navForecast: string;
  navResolution: string;
  navReserve: string;
  navAgreements: string;
  navNegotiations: string;
  navRiskProfiles: string;
  navCommitments: string;
  navVerify: string;
  navPayments: string;
  navLedgers: string;
  navCommunications: string;
  navAutomation: string;
  navReports: string;
  // Dashboard & Common
  openingOperatingCash: string;
  emergencyReserve: string;
  expectedReceipts: string;
  upcomingPayments: string;
  projectedClosing: string;
  cashGap: string;
  actionRequired: string;
  safeStatus: string;
  shortageExpected: string;
  dailyPlanReady: string;
  voiceBriefing: string;
  smartExit: string;
  login: string;
  logout: string;
  demoLogin: string;
  register: string;
  email: string;
  password: string;
  fullName: string;
  businessName: string;
  language: string;
}

export const translations: Record<LanguageCode, TranslationDictionary> = {
  en: {
    appName: 'FlowBridge',
    tagline: 'Know where your money is, what needs attention and what to do next.',
    navDashboard: 'Dashboard',
    navForecast: 'Cash Forecast',
    navResolution: 'Resolution Autopilot',
    navReserve: 'Emergency Reserve',
    navAgreements: 'Credit Agreements',
    navNegotiations: 'Payment Negotiations',
    navRiskProfiles: 'Retailer Risk Radar',
    navCommitments: 'Commitment Lifecycle',
    navVerify: 'Verification & Radar',
    navPayments: 'Payments & Reconciliation',
    navLedgers: 'Ledgers & Settings',
    navCommunications: 'Communications Centre',
    navAutomation: 'Automation Centre',
    navReports: 'Daily Financial Plan',
    openingOperatingCash: 'Opening Operating Cash',
    emergencyReserve: 'Emergency Reserve',
    expectedReceipts: 'Expected Receipts',
    upcomingPayments: 'Upcoming Obligations',
    projectedClosing: 'Projected Closing Cash',
    cashGap: 'Projected Cash Gap',
    actionRequired: 'Action Required',
    safeStatus: 'Cash Flow Safe',
    shortageExpected: 'Shortage Expected',
    dailyPlanReady: 'Daily Financial Plan Ready',
    voiceBriefing: 'Voice Briefing',
    smartExit: 'Smart Exit',
    login: 'Log In',
    logout: 'Log Out',
    demoLogin: 'One-Click Demo Login',
    register: 'Create Account',
    email: 'Email Address',
    password: 'Password',
    fullName: 'Full Name',
    businessName: 'Business / Distribution Name',
    language: 'Language',
  },
  kn: {
    appName: 'ಫ್ಲೋಬ್ರಿಡ್ಜ್ (FlowBridge)',
    tagline: 'ನಿಮ್ಮ ಹಣ ಎಲ್ಲಿದೆ, ಏನನ್ನು ಗಮನಿಸಬೇಕು ಮತ್ತು ಮುಂದೆ ಏನು ಮಾಡಬೇಕೆಂದು ತಿಳಿಯಿರಿ.',
    navDashboard: 'ಡ್ಯಾಶ್‌ಬೋರ್ಡ್',
    navForecast: 'ನಗದು ಮುನ್ಸೂಚನೆ',
    navResolution: 'ಪರಿಹಾರ ಆಟೋ ಪೈಲಟ್',
    navReserve: 'ತುರ್ತು ಮೀಸಲು ನಿಧಿ',
    navAgreements: 'ಸಾಲ ಒಪ್ಪಂದಗಳು',
    navNegotiations: 'ಪಾವತಿ ಮಾತುಕತೆಗಳು',
    navRiskProfiles: 'ವ್ಯಾಪಾರಿ ಅಪಾಯ ವಿವರ',
    navCommitments: 'ಬದ್ಧತೆಗಳ ಟ್ರ್ಯಾಕಿಂಗ್',
    navVerify: 'ಪರಿಶೀಲನೆ ಮತ್ತು ರಾಡಾರ್',
    navPayments: 'ಪಾವತಿಗಳು ಮತ್ತು ಹೊಂದಾಣಿಕೆ',
    navLedgers: 'ಖಾತೆಗಳು ಮತ್ತು ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    navCommunications: 'ಸಂವಹನ ಕೇಂದ್ರ',
    navAutomation: 'ಸ್ವಯಂಚಾಲಿತ ಕೇಂದ್ರ',
    navReports: 'ದೈನಂದಿನ ಹಣಕಾಸು ಯೋಜನೆ',
    openingOperatingCash: 'ಆರಂಭಿಕ ಕಾರ್ಯಾಚರಣಾ ನಗದು',
    emergencyReserve: 'ತುರ್ತು ಮೀಸಲು ನಿಧಿ',
    expectedReceipts: 'ನಿರೀಕ್ಷಿತ ಒಳಹರಿವು',
    upcomingPayments: 'ಮುಂಬರುವ ಬಾಧ್ಯತೆಗಳು',
    projectedClosing: 'ಅಂದಾಜು ಅಂತ್ಯ ನಗದು',
    cashGap: 'ನಗದು ಕೊರತೆ',
    actionRequired: 'ಕ್ರಮ ಕೈಗೊಳ್ಳಿ',
    safeStatus: 'ಹಣದ ಹರಿವು ಸುರಕ್ಷಿತವಾಗಿದೆ',
    shortageExpected: 'ಕೊರತೆ ನಿರೀಕ್ಷಿಸಲಾಗಿದೆ',
    dailyPlanReady: 'ದೈನಂದಿನ ಹಣಕಾಸು ಯೋಜನೆ ಸಿದ್ಧವಾಗಿದೆ',
    voiceBriefing: 'ಧ್ವನಿ ಬ್ರೀಫಿಂಗ್',
    smartExit: 'ಸ್ಮಾರ್ಟ್ ನಿರ್ಗಮನ',
    login: 'ಲಾಗಿನ್',
    logout: 'ಲಾಗ್ ಔಟ್',
    demoLogin: 'ಡೆಮೊ ಲಾಗಿನ್',
    register: 'ಖಾತೆ ತೆರೆಯಿರಿ',
    email: 'ಇಮೇಲ್ ವಿಳಾಸ',
    password: 'ಪಾಸ್‌ವರ್ಡ್',
    fullName: 'ಪೂರ್ಣ ಹೆಸರು',
    businessName: 'ವ್ಯಾಪಾರ / ವಿತರಕರ ಹೆಸರು',
    language: 'ಭಾಷೆ',
  },
  hi: {
    appName: 'फ़्लोब्रिज (FlowBridge)',
    tagline: 'जानिए आपका पैसा कहाँ है, किस पर ध्यान देना है और आगे क्या करना है।',
    navDashboard: 'डैशबोर्ड',
    navForecast: 'कैश पूर्वानुमान',
    navResolution: 'समाधान ऑटोपायलट',
    navReserve: 'इमरजेंसी रिज़र्व',
    navAgreements: 'क्रेडिट अनुबंध',
    navNegotiations: 'भुगतान बातचीत',
    navRiskProfiles: 'व्यापारी जोखिम प्रोफ़ाइल',
    navCommitments: 'प्रतिबद्धता ट्रैकिंग',
    navVerify: 'सत्यापन एवं रडार',
    navPayments: 'भुगतान और मिलान',
    navLedgers: 'खाताबही और सेटिंग्स',
    navCommunications: 'संचार केंद्र',
    navAutomation: 'स्वचालन केंद्र',
    navReports: 'दैनिक वित्तीय योजना',
    openingOperatingCash: 'प्रारंभिक कार्यशील नकद',
    emergencyReserve: 'आपातकालीन रिज़र्व',
    expectedReceipts: 'अपेक्षित प्राप्तियां',
    upcomingPayments: 'आगामी देनदारियां',
    projectedClosing: 'अनुमानित अंतिम नकद',
    cashGap: 'नकद अंतर / कमी',
    actionRequired: 'कार्रवाई आवश्यक',
    safeStatus: 'कैश फ्लो सुरक्षित',
    shortageExpected: 'कमी की संभावना',
    dailyPlanReady: 'दैनिक वित्तीय योजना तैयार है',
    voiceBriefing: 'आवाज़ ब्रीफिंग',
    smartExit: 'स्मार्ट निकास',
    login: 'लॉग इन',
    logout: 'लॉग आउट',
    demoLogin: 'डेमो लॉग इन',
    register: 'नया खाता बनाएं',
    email: 'ईमेल पता',
    password: 'पासवर्ड',
    fullName: 'पूरा नाम',
    businessName: 'व्यवसाय / वितरक का नाम',
    language: 'भाषा',
  },
};

