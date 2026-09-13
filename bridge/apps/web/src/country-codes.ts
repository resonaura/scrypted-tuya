export interface CountryCodeItem {
  code: string; // Dial code without +, e.g. "1", "7", "49"
  name: string;
  iso: string; // ISO 2-letter code, e.g. "US", "RU", "DE"
  flag: string;
}

export const POPULAR_COUNTRIES: CountryCodeItem[] = [
  { code: "1", name: "United States", iso: "US", flag: "🇺🇸" },
  { code: "1", name: "Canada", iso: "CA", flag: "🇨🇦" },
  { code: "7", name: "Russia", iso: "RU", flag: "🇷🇺" },
  { code: "7", name: "Kazakhstan", iso: "KZ", flag: "🇰🇿" },
  { code: "49", name: "Germany", iso: "DE", flag: "🇩🇪" },
  { code: "44", name: "United Kingdom", iso: "GB", flag: "🇬🇧" },
  { code: "33", name: "France", iso: "FR", flag: "🇫🇷" },
  { code: "380", name: "Ukraine", iso: "UA", flag: "🇺🇦" },
  { code: "375", name: "Belarus", iso: "BY", flag: "🇧🇾" },
  { code: "39", name: "Italy", iso: "IT", flag: "🇮🇹" },
  { code: "34", name: "Spain", iso: "ES", flag: "🇪🇸" },
  { code: "48", name: "Poland", iso: "PL", flag: "🇵🇱" },
  { code: "31", name: "Netherlands", iso: "NL", flag: "🇳🇱" },
  { code: "90", name: "Turkey", iso: "TR", flag: "🇹🇷" },
  { code: "86", name: "China", iso: "CN", flag: "🇨🇳" },
  { code: "91", name: "India", iso: "IN", flag: "🇮🇳" },
  { code: "81", name: "Japan", iso: "JP", flag: "🇯🇵" },
  { code: "82", name: "South Korea", iso: "KR", flag: "🇰🇷" },
  { code: "61", name: "Australia", iso: "AU", flag: "🇦🇺" },
  { code: "55", name: "Brazil", iso: "BR", flag: "🇧🇷" },
  { code: "52", name: "Mexico", iso: "MX", flag: "🇲🇽" },
  { code: "971", name: "United Arab Emirates", iso: "AE", flag: "🇦🇪" },
  { code: "972", name: "Israel", iso: "IL", flag: "🇮🇱" },
  { code: "41", name: "Switzerland", iso: "CH", flag: "🇨🇭" },
  { code: "43", name: "Austria", iso: "AT", flag: "🇦🇹" },
  { code: "32", name: "Belgium", iso: "BE", flag: "🇧🇪" },
  { code: "46", name: "Sweden", iso: "SE", flag: "🇸🇪" },
  { code: "47", name: "Norway", iso: "NO", flag: "🇳🇴" },
  { code: "45", name: "Denmark", iso: "DK", flag: "🇩🇰" },
  { code: "358", name: "Finland", iso: "FI", flag: "🇫🇮" },
  { code: "351", name: "Portugal", iso: "PT", flag: "🇵🇹" },
  { code: "30", name: "Greece", iso: "GR", flag: "🇬🇷" },
  { code: "420", name: "Czech Republic", iso: "CZ", flag: "🇨🇿" },
  { code: "40", name: "Romania", iso: "RO", flag: "🇷🇴" },
  { code: "36", name: "Hungary", iso: "HU", flag: "🇭🇺" },
  { code: "353", name: "Ireland", iso: "IE", flag: "🇮🇪" },
  { code: "65", name: "Singapore", iso: "SG", flag: "🇸🇬" },
  { code: "60", name: "Malaysia", iso: "MY", flag: "🇲🇾" },
  { code: "62", name: "Indonesia", iso: "ID", flag: "🇮🇩" },
  { code: "66", name: "Thailand", iso: "TH", flag: "🇹🇭" },
  { code: "84", name: "Vietnam", iso: "VN", flag: "🇻🇳" },
  { code: "63", name: "Philippines", iso: "PH", flag: "🇵🇭" },
  { code: "27", name: "South Africa", iso: "ZA", flag: "🇿🇦" },
  { code: "20", name: "Egypt", iso: "EG", flag: "🇪🇬" },
  { code: "54", name: "Argentina", iso: "AR", flag: "🇦🇷" },
  { code: "56", name: "Chile", iso: "CL", flag: "🇨🇱" },
  { code: "57", name: "Colombia", iso: "CO", flag: "🇨🇴" },
  { code: "64", name: "New Zealand", iso: "NZ", flag: "🇳🇿" },
  { code: "995", name: "Georgia", iso: "GE", flag: "🇬🇪" },
  { code: "374", name: "Armenia", iso: "AM", flag: "🇦🇲" },
  { code: "994", name: "Azerbaijan", iso: "AZ", flag: "🇦🇿" },
  { code: "998", name: "Uzbekistan", iso: "UZ", flag: "🇺🇿" },
  { code: "371", name: "Latvia", iso: "LV", flag: "🇱🇻" },
  { code: "370", name: "Lithuania", iso: "LT", flag: "🇱🇹" },
  { code: "372", name: "Estonia", iso: "EE", flag: "🇪🇪" },
];

export function cleanCountryCode(input: string): string {
  if (!input) return "1";
  const cleaned = input.replace(/[^0-9]/g, "");
  return cleaned || "1";
}

export function getDefaultCountryCodeForRegion(regionId: string): string {
  switch (regionId) {
    case "eu":
      return "49"; // Western Europe (Germany)
    case "we":
      return "7"; // Eastern Europe (Russia/Kazakhstan)
    case "us":
    case "ue":
      return "1"; // USA / North America
    case "cn":
      return "86"; // China
    case "in":
      return "91"; // India
    default:
      return "1";
  }
}
