import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type Language = 'th' | 'en';
type LanguageContextValue = { language: Language; setLanguage: (language: Language) => void };
const LanguageContext = createContext<LanguageContextValue | null>(null);

// Keys retain the application's original English wording for a faithful EN view.
const translations: Record<string, string> = {
  'Dashboard': 'แดชบอร์ด', 'Project': 'โครงการ', 'Projects': 'รายการโครงการ', 'Inventory': 'สินค้าคงคลัง',
  'Stock': 'คลังสินค้า', 'Receiving': 'รับสินค้า', 'Store': 'คลังโครงการ', 'Withdraw': 'เบิกสินค้า', 'Dispatch': 'จัดส่งสินค้า',
  'User Mgmt': 'จัดการผู้ใช้', 'Settings': 'ตั้งค่า', 'Logout': 'ออกจากระบบ', 'Search': 'ค้นหา',
  'Search here.....': 'ค้นหาที่นี่...', 'All Category': 'ทุกหมวดหมู่', 'Stock Value': 'มูลค่าสินค้าคงคลัง',
  'Pending': 'รอดำเนินการ', 'In Transit': 'กำลังขนส่ง', 'Received': 'รับแล้ว', 'Recent Stock Movement': 'ความเคลื่อนไหวสินค้าล่าสุด',
  'View stock': 'ดูสินค้าคงคลัง', 'Role Permissions': 'สิทธิ์ตามบทบาท', 'Project List': 'รายการโครงการ',
  'Search projects': 'ค้นหาโครงการ', 'Store Inventory': 'สินค้าคงคลังโครงการ', 'Search store items': 'ค้นหารายการสินค้าในคลัง',
  'Search inventory': 'ค้นหาสินค้าคงคลัง', 'Dispatch Selected': 'จัดส่งรายการที่เลือก', 'Waiting for Receipt': 'รอการรับสินค้า',
  'Create Withdraw': 'สร้างรายการเบิก', 'Withdraw Records': 'รายการเบิกสินค้า', 'Waiting Return / Due': 'รอคืน / กำหนดคืน',
  'User Control Panel': 'จัดการผู้ใช้', 'Loading directory...': 'กำลังโหลดรายชื่อ...', 'Approve': 'อนุมัติ',
  'Create Account': 'สร้างบัญชีผู้ใช้', 'First Name': 'ชื่อ', 'Last Name': 'นามสกุล', 'Password': 'รหัสผ่าน',
  'Email Address': 'อีเมล', 'Submit Registration': 'ส่งคำขอลงทะเบียน', 'Sign In with Password': 'เข้าสู่ระบบด้วยรหัสผ่าน',
  'Continue with Google': 'ดำเนินการต่อด้วย Google', 'Sign Up Now': 'สมัครใช้งาน', 'Sign In': 'เข้าสู่ระบบ',
  'Pending Registration Approval': 'รออนุมัติการลงทะเบียน', 'Log Out and Return': 'ออกจากระบบและกลับ',
  'Edit Profile': 'แก้ไขโปรไฟล์', 'Cancel': 'ยกเลิก', 'Save Settings': 'บันทึกการตั้งค่า',
  'Status': 'สถานะ', 'Action': 'การดำเนินการ', 'Items': 'รายการ', 'Amount': 'มูลค่า', 'Qty': 'จำนวน',
  'Available': 'คงเหลือ', 'No photo': 'ไม่มีรูปภาพ',
};

function translateDocument(language: Language) {
  const lookup = language === 'th' ? translations : Object.fromEntries(Object.entries(translations).map(([en, th]) => [th, en]));
  const translate = (value: string) => lookup[value.trim()] ?? value;
  document.documentElement.lang = language;
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  nodes.forEach((node) => { const next = translate(node.nodeValue ?? ''); if (next !== node.nodeValue) node.nodeValue = next; });
  document.querySelectorAll<HTMLElement>('[placeholder], [title], [aria-label]').forEach((element) => {
    ['placeholder', 'title', 'aria-label'].forEach((attribute) => {
      const value = element.getAttribute(attribute);
      if (value) element.setAttribute(attribute, translate(value));
    });
  });
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => localStorage.getItem('cmg-language') === 'en' ? 'en' : 'th');
  useEffect(() => {
    localStorage.setItem('cmg-language', language);
    translateDocument(language);
    const observer = new MutationObserver(() => translateDocument(language));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useLanguage must be used within LanguageProvider');
  return context;
}
