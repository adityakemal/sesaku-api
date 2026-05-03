// Shared types
export type TransactionSource = "Web" | "AI";

export interface TaxItem {
  name: string;
  value: number;
  type: "percent" | "fixed";
}

export interface DiscountItem {
  name: string;
  value: number;
  type: "percent" | "fixed";
}

export interface TransactionItem {
  name: string;
  price: number;
}

export interface TransactionDetails {
  items?: TransactionItem[];
  tax?: TaxItem[];
  discount?: DiscountItem[];
}

export interface Transaction {
  id: string;
  user_id: string;
  name: string;
  nominal: number;
  kategori: string;
  keterangan: string;
  date: string;
  source: TransactionSource;
  details?: TransactionDetails;
}

export interface Category {
  id: number;
  user_id: string;
  name: string;
  created_at: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar: string;
  google_id: string | null;
  created_at: string;
}

export interface MonthlyBudget {
  month: string; // "YYYY-MM"
  amount: number;
}

export interface AppState {
  transactions: Transaction[];
  categories: Category[];
  defaultBudget: number;
  monthlyBudgets: MonthlyBudget[];
}
