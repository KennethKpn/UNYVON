"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  ArrowRight,
  Building2,
  Package,
  Users,
  ShoppingCart,
  Sparkles,
  Plus,
  X,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  createOrganizationAction,
  getOnboardingStateAction,
  syncOnboardingCustomers,
  syncOnboardingProducts,
  syncOnboardingSale,
  syncOnboardingStock,
  type OnboardingCustomer,
  type OnboardingProduct,
} from "@/lib/supabase/org-actions";
import { cn, formatFCFA } from "@/lib/utils";
import { SmartImportPrompt } from "@/components/import/smart-import-prompt";

const steps = [
  { id: 1, label: "Entreprise", icon: Building2 },
  { id: 2, label: "Activité", icon: Building2 },
  { id: 3, label: "Produits", icon: Package },
  { id: 4, label: "Stock", icon: Package },
  { id: 5, label: "Clients", icon: Users },
  { id: 6, label: "Première vente", icon: ShoppingCart },
  { id: 7, label: "Insight", icon: Sparkles },
];

type LocalProduct = OnboardingProduct & { key: string };
type LocalCustomer = OnboardingCustomer & { key: string };

let localKeySeq = 0;
function nextKey(): string {
  localKeySeq += 1;
  return `local-${localKeySeq}`;
}

const EXAMPLE_PRODUCTS: OnboardingProduct[] = [
  { id: null, name: "Riz 25kg", unit: "sac", costPrice: 18000, salePrice: 22000, minStockThreshold: 100, categoryId: null },
  { id: null, name: "Huile 5L", unit: "bidon", costPrice: 12000, salePrice: 15500, minStockThreshold: 40, categoryId: null },
  { id: null, name: "Maïs 50kg", unit: "sac", costPrice: 22000, salePrice: 28000, minStockThreshold: 50, categoryId: null },
  { id: null, name: "Soja 50kg", unit: "sac", costPrice: 25000, salePrice: 32000, minStockThreshold: 30, categoryId: null },
  { id: null, name: "Aliment bétail 50kg", unit: "sac", costPrice: 19000, salePrice: 24000, minStockThreshold: 25, categoryId: null },
];

const EXAMPLE_STOCK_BY_NAME: Record<string, number> = {
  "Riz 25kg": 340,
  "Huile 5L": 85,
  "Maïs 50kg": 120,
  "Soja 50kg": 15,
  "Aliment bétail 50kg": 60,
};

const EXAMPLE_CUSTOMERS: OnboardingCustomer[] = [
  { id: null, name: "Épicerie Sainte-Rita", phone: "+229 97 00 00 01", email: "", address: "Quartier Zongo, Cotonou", notes: "" },
  { id: null, name: "Marché Zongo", phone: "+229 97 00 00 02", email: "", address: "Marché Dantokpa, Cotonou", notes: "" },
  { id: null, name: "Restaurant Chez Maman", phone: "+229 97 00 00 03", email: "", address: "Haie-Vive, Cotonou", notes: "" },
];

function deriveStep(
  hasOrg: boolean,
  productCount: number,
  openingCount: number,
  customerCount: number,
  hasSale: boolean
): number {
  if (!hasOrg) return 1;
  if (productCount === 0) return 3;
  if (openingCount === 0) return 4;
  if (customerCount === 0) return 5;
  if (!hasSale) return 6;
  return 7;
}

function friendlyError(error: string): string {
  if (error === "UNAUTHENTICATED") return "Vous devez être connecté pour continuer.";
  if (error === "NOT_CONFIGURED") return "Les données ne sont pas disponibles pour le moment. Réessayez dans un instant.";
  if (error === "NO_ORG") return "Créez d'abord votre entreprise avant de continuer.";
  return error;
}

export default function OnboardingPage() {
  return <OnboardingWizard />;
}

function OnboardingWizard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [sector, setSector] = useState("Distribution B2B agroalimentaire");
  const [currency, setCurrency] = useState("FCFA");
  const [activity, setActivity] = useState("");
  const [products, setProducts] = useState<LocalProduct[]>([]);
  const [customers, setCustomers] = useState<LocalCustomer[]>([]);
  const [stockQuantities, setStockQuantities] = useState<Record<string, number>>({});
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState(0);
  const [newProductCost, setNewProductCost] = useState(0);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [saleCustomerId, setSaleCustomerId] = useState("");
  const [saleQty, setSaleQty] = useState<Record<string, number>>({});
  const [currentStep, setCurrentStep] = useState(1);
  const [busyStep, setBusyStep] = useState(0);
  const [syncError, setSyncError] = useState("");
  const hydratedRef = useRef(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    (async () => {
      const state = await getOnboardingStateAction();
      if (!state.ok) {
        setLoadError(friendlyError(state.error));
        setLoading(false);
        return;
      }
      setOrgId(state.organization?.id ?? null);
      if (state.organization) {
        setOrgName(state.organization.name);
        setSector(state.organization.sector);
        setCurrency(state.organization.currency);
      }
      const hydratedProducts = state.products.map((p) => ({ ...p, key: nextKey() }));
      setProducts(hydratedProducts);
      const hydratedStock: Record<string, number> = {};
      for (const p of hydratedProducts) {
        if (p.id != null && state.stockQuantities[p.id] != null) {
          hydratedStock[p.key] = state.stockQuantities[p.id];
        }
      }
      setStockQuantities(hydratedStock);
      setCustomers(state.customers.map((c) => ({ ...c, key: nextKey() })));
      const openingCount = Object.values(hydratedStock).filter((q) => q > 0).length;
      const derivedStep = deriveStep(
        state.organization != null,
        hydratedProducts.length,
        openingCount,
        state.customers.length,
        state.hasConfirmedSale
      );
      const requestedStep = Number(
        new URLSearchParams(window.location.search).get("step")
      );
      const canHonorRequestedStep =
        Number.isInteger(requestedStep) &&
        requestedStep >= 1 &&
        requestedStep <= 7 &&
        (requestedStep === 1 || state.organization != null);
      setCurrentStep(canHonorRequestedStep ? requestedStep : derivedStep);
      setLoading(false);
    })();
  }, []);

  const progress = (currentStep / steps.length) * 100;
  const busy = busyStep > 0;

  const canStep1 = orgName.trim().length > 0;
  const canStep3 = newProductName.trim().length > 0 && newProductPrice > 0 && newProductCost >= 0;
  const hasPositiveStock = products.some((p) => (stockQuantities[p.key] ?? 0) > 0);

  const cartItems = products
    .filter((p) => (saleQty[p.key] ?? 0) > 0 && p.id != null)
    .map((p) => ({
      productId: p.id as string,
      productName: p.name,
      quantity: saleQty[p.key],
      total: saleQty[p.key] * p.salePrice,
    }));
  const saleTotal = cartItems.reduce((sum, i) => sum + i.total, 0);
  const saleCustomer = customers.find((c) => c.id === saleCustomerId);
  const canStep6 = cartItems.length > 0 && saleTotal > 0;

  const addExampleProducts = () => {
    setProducts((prev) => {
      const existing = new Set(prev.map((p) => p.name.trim().toLowerCase()));
      const added: LocalProduct[] = [];
      const stockPatch: Record<string, number> = {};
      for (const example of EXAMPLE_PRODUCTS) {
        if (existing.has(example.name.toLowerCase())) continue;
        const key = nextKey();
        added.push({ ...example, key });
        const qty = EXAMPLE_STOCK_BY_NAME[example.name];
        if (qty != null) stockPatch[key] = qty;
      }
      if (Object.keys(stockPatch).length > 0) {
        setStockQuantities((s) => ({ ...s, ...stockPatch }));
      }
      return [...prev, ...added];
    });
  };

  const addExampleCustomers = () => {
    setCustomers((prev) => {
      const existing = new Set(prev.map((c) => c.name.trim().toLowerCase()));
      const added = EXAMPLE_CUSTOMERS.filter(
        (example) => !existing.has(example.name.toLowerCase())
      ).map((example) => ({ ...example, key: nextKey() }));
      return [...prev, ...added];
    });
  };

  const removeProduct = (key: string) => {
    setProducts((prev) => prev.filter((p) => p.key !== key));
    setStockQuantities((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
    setSaleQty((prev) => {
      const copy = { ...prev };
      delete copy[key];
      return copy;
    });
  };

  const removeCustomer = (key: string) => {
    setCustomers((prev) => prev.filter((c) => c.key !== key));
  };

  const handleNext = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setSyncError("");
    try {
      if (currentStep === 1) {
        setBusyStep(1);
        const res = await createOrganizationAction({ name: orgName, sector, currency });
        setBusyStep(0);
        if (!res.ok) {
          setSyncError(friendlyError(res.error));
          return;
        }
        setOrgId(res.organizationId);
        setCurrentStep(2);
        return;
      }

      if (currentStep === 2) {
        setCurrentStep(3);
        return;
      }

      if (!orgId) {
        setSyncError("Créez d'abord votre entreprise avant de continuer.");
        return;
      }

      if (currentStep === 3) {
        setBusyStep(3);
        const res = await syncOnboardingProducts({ organizationId: orgId, products });
        setBusyStep(0);
        if (!res.ok) {
          setSyncError(friendlyError(res.error));
          return;
        }
        setProducts((prev) =>
          prev.map((p) => ({
            ...p,
            id: p.id ?? res.productIds[p.name.toLowerCase()] ?? null,
          }))
        );
        setCurrentStep(4);
        return;
      }

      if (currentStep === 4) {
        setBusyStep(4);
        const entries = products
          .filter((p) => (stockQuantities[p.key] ?? 0) > 0 && p.id != null)
          .map((p) => ({ productId: p.id as string, quantity: stockQuantities[p.key] }));
        const res = await syncOnboardingStock({ organizationId: orgId, entries });
        setBusyStep(0);
        if (!res.ok) {
          setSyncError(friendlyError(res.error));
          return;
        }
        const state = await getOnboardingStateAction();
        if (state.ok) {
          const keyByRealId = new Map<string, string>();
          for (const p of products) if (p.id) keyByRealId.set(p.id, p.key);
          const persisted: Record<string, number> = {};
          for (const p of products) {
            const q = p.id != null ? state.stockQuantities[p.id] : undefined;
            if (q != null) persisted[p.key] = q;
          }
          setStockQuantities(persisted);
        }
        setCurrentStep(5);
        return;
      }

      if (currentStep === 5) {
        setBusyStep(5);
        const res = await syncOnboardingCustomers({ organizationId: orgId, customers });
        setBusyStep(0);
        if (!res.ok) {
          setSyncError(friendlyError(res.error));
          return;
        }
        setCustomers((prev) =>
          prev.map((c) => ({
            ...c,
            id: c.id ?? res.productIds[c.name.toLowerCase()] ?? null,
          }))
        );
        setCurrentStep(6);
        return;
      }

      if (currentStep === 6) {
        setBusyStep(6);
        const res = await syncOnboardingSale({
          organizationId: orgId,
          customerId: saleCustomerId || null,
          customerName: saleCustomer?.name ?? "Client comptoir",
          items: cartItems,
          total: saleTotal,
          amountPaid: saleTotal,
        });
        setBusyStep(0);
        if (!res.ok) {
          setSyncError(friendlyError(res.error));
          return;
        }
        setCurrentStep(7);
        return;
      }
    } finally {
      busyRef.current = false;
    }
  };

  const onPrimary = () => {
    if (currentStep === 7) {
      router.push("/dashboard");
      return;
    }
    void handleNext();
  };


  const ensureImportOrganization = async (): Promise<boolean> => {
    if (orgId) return true;
    if (!canStep1) {
      setSyncError("Renseignez d'abord le nom de votre entreprise pour lancer l'import.");
      return false;
    }

    setBusyStep(1);
    try {
      const res = await createOrganizationAction({
        name: orgName,
        sector,
        currency,
      });
      if (!res.ok) {
        setSyncError(friendlyError(res.error));
        return false;
      }
      setOrgId(res.organizationId);
      return true;
    } catch (error) {
      setSyncError(
        error instanceof Error
          ? error.message
          : "Impossible de préparer votre entreprise pour l'import."
      );
      return false;
    } finally {
      setBusyStep(0);
    }
  };

  const primaryDisabled =
    busy ||
    (currentStep === 1 && !canStep1) ||
    (currentStep === 4 && !hasPositiveStock) ||
    (currentStep === 6 && !canStep6);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="h-16 border-b border-border bg-surface flex items-center px-6">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center">
              <span className="text-white font-display font-bold text-sm">U</span>
            </div>
            <span className="font-display font-semibold text-lg text-ink">UNYVON</span>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <span className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="h-16 border-b border-border bg-surface flex items-center px-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-[10px] bg-primary flex items-center justify-center">
            <span className="text-white font-display font-bold text-sm">U</span>
          </div>
          <span className="font-display font-semibold text-lg text-ink">UNYVON</span>
        </div>
      </div>

      <div className="h-1 bg-background">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center p-6 max-w-lg mx-auto w-full">
        {loadError ? (
          <div className="w-full p-6 rounded-[16px] border border-error/30 bg-error/5">
            <p className="text-sm text-error">{loadError}</p>
            <Button
              className="mt-4 w-full"
              size="lg"
              onClick={() => window.location.reload()}
            >
              Réessayer
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-8">
              {steps.map((step) => (
                <div
                  key={step.id}
                  className={cn(
                    "w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium transition-all duration-300",
                    step.id < currentStep
                      ? "bg-success text-white"
                      : step.id === currentStep
                      ? "bg-primary text-white ring-4 ring-primary/20"
                      : "bg-background text-muted border border-border"
                  )}
                >
                  {step.id < currentStep ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    step.id
                  )}
                </div>
              ))}
            </div>

            <h2 className="font-display text-xl font-bold text-ink mb-2">
              {steps[currentStep - 1].label}
            </h2>
            <p className="text-sm text-muted text-center mb-8">
              {currentStep === 1 && "Nommez votre entreprise et choisissez votre secteur."}
              {currentStep === 2 && "Décrivez brièvement votre activité pour personnaliser l'expérience."}
              {currentStep === 3 && "Ajoutez vos produits avec leur coût et prix de vente."}
              {currentStep === 4 && "Définissez le stock initial de chaque produit."}
              {currentStep === 5 && "Ajoutez votre premier client."}
              {currentStep === 6 && "Enregistrez votre première vente pour voir le système en action."}
              {currentStep === 7 && "NOVA analyse vos données et vous donne votre premier insight."}
            </p>
            
            <SmartImportPrompt
              returnTo="/onboarding"
              step={currentStep}
              ensureReady={ensureImportOrganization}
              compact={false}
              title="Gagnez du temps : importez vos données"
              description="Au lieu de tout renseigner à la main, déposez vos documents ou prenez en photo vos registres. UNYVON prépare vos données pour vous."
            />

            <div className="w-full p-6 rounded-[16px] border border-border bg-surface mb-8">
              {currentStep === 1 && (
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium text-text block mb-1.5">
                      Nom de l&apos;entreprise
                    </label>
                    <input
                      type="text"
                      value={orgName}
                      onChange={(e) => setOrgName(e.target.value)}
                      className="w-full h-11 px-4 rounded-[10px] border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text block mb-1.5">Secteur</label>
                    <select
                      value={sector}
                      onChange={(e) => setSector(e.target.value)}
                      className="w-full h-11 px-4 rounded-[10px] border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      <option>Distribution B2B agroalimentaire</option>
                      <option>Commerce général</option>
                      <option>Restaurant</option>
                      <option>Services</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-medium text-text block mb-1.5">Devise</label>
                    <input
                      type="text"
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="w-full h-11 px-4 rounded-[10px] border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                  </div>
                </div>
              )}

              {currentStep === 2 && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-text block mb-1.5">
                    Décrivez votre activité
                  </label>
                  <textarea
                    rows={4}
                    value={activity}
                    onChange={(e) => setActivity(e.target.value)}
                    placeholder="Ex. Nous distribuons des produits agroalimentaires en gros aux épiceries de Cotonou..."
                    className="w-full px-4 py-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                  />
                  <p className="text-xs text-muted">
                    Cette description permet à NOVA de mieux contextualiser vos recommandations.
                  </p>
                </div>
              )}

              {currentStep === 3 && (
                <div className="space-y-3">
                  {products.length === 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={addExampleProducts}
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-[10px] border border-dashed border-primary/40 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      Ajouter des exemples agro
                    </button>
                  )}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                    <input
                      type="text"
                      value={newProductName}
                      onChange={(e) => setNewProductName(e.target.value)}
                      placeholder="Nom du produit"
                      className="flex-1 h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={newProductCost === 0 ? "" : newProductCost}
                        onChange={(e) => setNewProductCost(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="Prix d'achat"
                        aria-label="Prix d'achat"
                        className="flex-1 w-24 h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                      <input
                        type="number"
                        min="0"
                        value={newProductPrice === 0 ? "" : newProductPrice}
                        onChange={(e) => setNewProductPrice(Math.max(0, Number(e.target.value) || 0))}
                        placeholder="Prix"
                        aria-label="Prix de vente"
                        className="flex-1 w-24 h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                      />
                      <Button
                        size="sm"
                        disabled={!canStep3 || busy}
                        onClick={() => {
                          setProducts((prev) => [
                            ...prev,
                            {
                              id: null,
                              name: newProductName.trim(),
                              unit: "unité",
                              costPrice: newProductCost,
                              salePrice: newProductPrice,
                              minStockThreshold: 0,
                              categoryId: null,
                              key: nextKey(),
                            },
                          ]);
                          setNewProductName("");
                          setNewProductPrice(0);
                          setNewProductCost(0);
                        }}
                        className="shrink-0"
                      >
                        <Plus className="w-4 h-4" />
                        Ajouter
                      </Button>
                    </div>
                  </div>
                  {products.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {products.map((p) => (
                        <div
                          key={p.key}
                          className="flex items-center justify-between p-3 rounded-[10px] border border-border bg-background"
                        >
                          <div>
                            <p className="text-sm font-medium text-ink">{p.name}</p>
                            <p className="text-xs text-muted">
                              Coût: {formatFCFA(p.costPrice)} — Vente: {formatFCFA(p.salePrice)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            {p.id === null && (
                              <button
                                type="button"
                                onClick={() => removeProduct(p.key)}
                                aria-label={`Retirer ${p.name}`}
                                className="p-1.5 ml-1 rounded-[8px] text-muted hover:text-error hover:bg-error/10 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {currentStep === 4 && (
                <div className="space-y-2">
                  <p className="text-sm text-muted mb-2">
                    Définissez le stock initial de chaque produit.
                  </p>
                  {products.map((p) => (
                    <div
                      key={p.key}
                      className="flex items-center justify-between gap-3 p-3 rounded-[10px] border border-border"
                    >
                      <p className="text-sm font-medium text-ink">{p.name}</p>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          value={stockQuantities[p.key] ?? 0}
                          onChange={(e) =>
                            setStockQuantities((prev) => ({
                              ...prev,
                              [p.key]: Math.max(0, Number(e.target.value) || 0),
                            }))
                          }
                          aria-label={`Stock initial pour ${p.name}`}
                          className="w-20 h-9 px-2 rounded-[8px] border border-border text-sm text-center text-ink focus:outline-none focus:ring-2 focus:ring-primary/20"
                        />
                        <span className="text-xs text-muted">{p.unit || "unité"}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {currentStep === 5 && (
                <div className="space-y-3">
                  {customers.length === 0 && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={addExampleCustomers}
                      className="w-full flex items-center justify-center gap-2 p-3 rounded-[10px] border border-dashed border-primary/40 text-sm font-medium text-primary hover:bg-primary/5 transition-colors disabled:opacity-50"
                    >
                      <Wand2 className="w-4 h-4" />
                      Ajouter des exemples de clients
                    </button>
                  )}
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newCustomerName}
                      onChange={(e) => setNewCustomerName(e.target.value)}
                      placeholder="Nom du client"
                      className="flex-1 h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    />
                    <Button
                      size="sm"
                      disabled={!/[a-zA-ZÀ-ÖØ-öø-ÿ]/.test(newCustomerName.trim()) || busy}
                      onClick={() => {
                        setCustomers((prev) => [
                          ...prev,
                          {
                            id: null,
                            name: newCustomerName.trim(),
                            phone: "",
                            email: "",
                            address: "",
                            notes: "",
                            key: nextKey(),
                          },
                        ]);
                        setNewCustomerName("");
                      }}
                    >
                      <Plus className="w-4 h-4" />
                      Ajouter
                    </Button>
                  </div>
                  {customers.length > 0 && (
                    <div className="mt-2 space-y-2">
                      {customers.map((c) => (
                        <div
                          key={c.key}
                          className="flex items-center justify-between p-3 rounded-[10px] border border-border bg-background"
                        >
                          <p className="text-sm font-medium text-ink">{c.name}</p>
                          <div className="flex items-center gap-1">
                            <CheckCircle2 className="w-4 h-4 text-success" />
                            {c.id === null && (
                              <button
                                type="button"
                                onClick={() => removeCustomer(c.key)}
                                aria-label={`Retirer ${c.name}`}
                                className="p-1.5 ml-1 rounded-[8px] text-muted hover:text-error hover:bg-error/10 transition-colors"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {currentStep === 6 && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-medium text-text block mb-1.5">Client</label>
                    <select
                      value={saleCustomerId}
                      onChange={(e) => {
                        setSaleCustomerId(e.target.value);
                        setSaleQty({});
                      }}
                      className="w-full h-10 px-3 rounded-[10px] border border-border bg-background text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
                    >
                      <option value="">Client comptoir</option>
                      {customers.map((c) => (
                        <option key={c.key} value={c.id ?? ""}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    {products.map((p) => {
                      const qty = saleQty[p.key] ?? 0;
                      return (
                        <div
                          key={p.key}
                          className="flex items-center justify-between gap-2 p-3 rounded-[10px] border border-border"
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-ink truncate">{p.name}</p>
                            <p className="text-xs text-muted">{formatFCFA(p.salePrice)}</p>
                          </div>
                          <input
                            type="number"
                            min="0"
                            value={qty === 0 ? "" : qty}
                            onChange={(e) =>
                              setSaleQty((prev) => ({
                                ...prev,
                                [p.key]: Math.max(0, Number(e.target.value) || 0),
                              }))
                            }
                            placeholder="0"
                            aria-label={`Quantité pour ${p.name}`}
                            className="w-16 h-9 px-2 rounded-[8px] border border-border text-sm text-center text-ink focus:outline-none focus:ring-2 focus:ring-primary/20"
                          />
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-[10px] bg-background">
                    <span className="text-sm text-muted">Total</span>
                    <span className="font-display font-semibold text-lg text-ink">
                      {formatFCFA(saleTotal)}
                    </span>
                  </div>
                </div>
              )}

              {currentStep === 7 && (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-[16px] bg-lavender-soft flex items-center justify-center mx-auto mb-4">
                    <Sparkles className="w-8 h-8 text-primary" />
                  </div>
                  <h3 className="font-display font-semibold text-ink mb-2">
                    Votre premier insight NOVA
                  </h3>
                  <div className="p-4 rounded-[12px] bg-warning/5 border border-warning/20 text-left mt-4">
                    <p className="text-sm font-medium text-ink">
                      Stock de {products[0]?.name ?? "produits"} — vigilance rapprovisionnement
                    </p>
                    <p className="text-xs text-muted mt-1">
                      {products.filter((p) => (stockQuantities[p.key] ?? 0) <= p.minStockThreshold && p.minStockThreshold > 0).length}{" "}
                      produit(s) proche(s) du seuil minimal. Configurez vos alertes dans le dashboard.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {syncError && (
              <div className="w-full p-3 rounded-[10px] border border-error/30 bg-error/5">
                <p className="text-sm text-error">{syncError}</p>
              </div>
            )}

            <div className="flex items-center gap-3 w-full">
              {currentStep > 1 && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setSyncError("");
                    setCurrentStep((cur) => Math.max(1, cur - 1));
                  }}
                >
                  Retour
                </Button>
              )}
              <Button
                className="flex-1"
                size="lg"
                disabled={primaryDisabled}
                onClick={onPrimary}
              >
                {busyStep === currentStep ? (
                  <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  currentStep === 7
                    ? "Accéder au dashboard"
                    : currentStep === 6
                    ? "Enregistrer la vente"
                    : "Suivant"
                )}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}