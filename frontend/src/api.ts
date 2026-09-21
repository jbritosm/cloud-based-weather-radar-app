export interface Product {
  id: number;
  provider: string;
  product_type: string;
  observed_at: string;
  storage_key: string | null;
}

export interface Provider {
  name: string;
  implemented: boolean;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export const fetchProviders = () => get<Provider[]>("/api/providers");
export const fetchProducts = (limit = 20) => get<Product[]>(`/api/products?limit=${limit}`);
