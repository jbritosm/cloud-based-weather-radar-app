import { useEffect, useState } from "react";
import { fetchProducts, fetchProviders, type Product, type Provider } from "./api";
import MapView from "./MapView";

export default function App() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchProducts()])
      .then(([prov, prod]) => {
        setProviders(prov);
        setProducts(prod);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="layout">
      <aside className="sidebar">
        <h1>Weather Radar Platform</h1>
        {error && <p className="error">API error: {error}</p>}

        <h2>Data sources</h2>
        <ul>
          {providers.map((p) => (
            <li key={p.name}>
              {p.name} <span className="tag">{p.implemented ? "active" : "planned"}</span>
            </li>
          ))}
        </ul>

        <h2>Latest ingested products</h2>
        {products.length === 0 && !error && <p>Nothing ingested yet.</p>}
        <ul>
          {products.map((p) => (
            <li key={p.id}>
              {p.provider}/{p.product_type}
              <br />
              <small>{new Date(p.observed_at).toLocaleString()}</small>
            </li>
          ))}
        </ul>
      </aside>
      <MapView />
    </div>
  );
}
