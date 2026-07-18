/**
 * Country / state / city catalog for address typeahead fields (JEE-form
 * style: type a few letters, pick from matching entries).
 *
 * Plain data, India-first — extend the lists to cover more places; a real
 * backend can later serve this exact shape (or swap in a places API) without
 * touching the screens.
 */

/** India first (the home market), then common countries alphabetically. */
export const COUNTRIES: string[] = [
  'India',
  'Australia',
  'Bangladesh',
  'Bhutan',
  'Brazil',
  'Canada',
  'China',
  'France',
  'Germany',
  'Indonesia',
  'Italy',
  'Japan',
  'Malaysia',
  'Maldives',
  'Myanmar',
  'Nepal',
  'Netherlands',
  'New Zealand',
  'Oman',
  'Pakistan',
  'Qatar',
  'Russia',
  'Saudi Arabia',
  'Singapore',
  'South Africa',
  'South Korea',
  'Spain',
  'Sri Lanka',
  'Thailand',
  'Turkey',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'Vietnam',
];

export interface StateEntry {
  name: string;
  cities: string[];
}

/** Indian states & union territories with their major cities. */
export const INDIAN_STATES: StateEntry[] = [
  { name: 'Andhra Pradesh', cities: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Tirupati', 'Rajahmundry', 'Kakinada', 'Kadapa', 'Anantapur'] },
  { name: 'Arunachal Pradesh', cities: ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang'] },
  { name: 'Assam', cities: ['Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur'] },
  { name: 'Bihar', cities: ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Arrah', 'Begusarai', 'Bihar Sharif'] },
  { name: 'Chhattisgarh', cities: ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Raigarh'] },
  { name: 'Goa', cities: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'] },
  { name: 'Gujarat', cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Gandhinagar', 'Junagadh', 'Anand', 'Nadiad', 'Morbi'] },
  { name: 'Haryana', cities: ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal', 'Sonipat', 'Panchkula'] },
  { name: 'Himachal Pradesh', cities: ['Shimla', 'Mandi', 'Solan', 'Dharamshala', 'Kullu', 'Manali'] },
  { name: 'Jharkhand', cities: ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro Steel City', 'Deoghar', 'Hazaribagh'] },
  { name: 'Karnataka', cities: ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Davanagere', 'Ballari', 'Tumakuru', 'Shivamogga', 'Udupi'] },
  { name: 'Kerala', cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur', 'Alappuzha', 'Palakkad', 'Kottayam'] },
  { name: 'Madhya Pradesh', cities: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam', 'Rewa', 'Katni', 'Khandwa'] },
  { name: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Chhatrapati Sambhajinagar', 'Solapur', 'Kolhapur', 'Amravati', 'Navi Mumbai', 'Sangli', 'Jalgaon', 'Akola', 'Latur'] },
  { name: 'Manipur', cities: ['Imphal'] },
  { name: 'Meghalaya', cities: ['Shillong', 'Tura'] },
  { name: 'Mizoram', cities: ['Aizawl'] },
  { name: 'Nagaland', cities: ['Kohima', 'Dimapur'] },
  { name: 'Odisha', cities: ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore'] },
  { name: 'Punjab', cities: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur', 'Pathankot'] },
  { name: 'Rajasthan', cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bikaner', 'Ajmer', 'Alwar', 'Bhilwara', 'Sikar', 'Sri Ganganagar'] },
  { name: 'Sikkim', cities: ['Gangtok'] },
  { name: 'Tamil Nadu', cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode', 'Vellore', 'Thoothukudi', 'Thanjavur', 'Tiruppur'] },
  { name: 'Telangana', cities: ['Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam', 'Secunderabad'] },
  { name: 'Tripura', cities: ['Agartala'] },
  { name: 'Uttar Pradesh', cities: ['Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Bareilly', 'Aligarh', 'Moradabad', 'Noida', 'Gorakhpur', 'Jhansi', 'Saharanpur', 'Mathura', 'Ayodhya'] },
  { name: 'Uttarakhand', cities: ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rishikesh', 'Nainital'] },
  { name: 'West Bengal', cities: ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Darjeeling', 'Kharagpur'] },
  { name: 'Andaman and Nicobar Islands', cities: ['Port Blair'] },
  { name: 'Chandigarh', cities: ['Chandigarh'] },
  { name: 'Dadra and Nagar Haveli and Daman and Diu', cities: ['Daman', 'Silvassa', 'Diu'] },
  { name: 'Delhi', cities: ['New Delhi', 'Delhi'] },
  { name: 'Jammu and Kashmir', cities: ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla'] },
  { name: 'Ladakh', cities: ['Leh', 'Kargil'] },
  { name: 'Lakshadweep', cities: ['Kavaratti'] },
  { name: 'Puducherry', cities: ['Puducherry', 'Karaikal'] },
];

const ALL_CITIES: string[] = INDIAN_STATES.flatMap((s) => s.cities).sort((a, b) =>
  a.localeCompare(b),
);

const STATE_BY_CITY = new Map<string, string>();
for (const state of INDIAN_STATES) {
  for (const city of state.cities) {
    if (!STATE_BY_CITY.has(city.toLowerCase())) STATE_BY_CITY.set(city.toLowerCase(), state.name);
  }
}

/** All Indian state / UT names. */
export const STATE_NAMES: string[] = INDIAN_STATES.map((s) => s.name);

/** Cities in a state; every known city when the state is unknown/blank. */
export function citiesForState(stateName?: string): string[] {
  const state = INDIAN_STATES.find(
    (s) => s.name.toLowerCase() === (stateName ?? '').trim().toLowerCase(),
  );
  return state ? state.cities : ALL_CITIES;
}

/** Which state a known city belongs to — lets picking a city auto-fill it. */
export function stateForCity(city: string): string | undefined {
  return STATE_BY_CITY.get(city.trim().toLowerCase());
}
