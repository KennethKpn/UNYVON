"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, FileUp, Loader2, RefreshCw, ShieldCheck, Trash2, Wand2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useOrg } from "@/lib/context/org-context";
import {
  addImportDocument, cancelImportSession, commitImportSession, createImportSession,
  decideImportItem, deleteImportDocument, finalizeImportReview, markImportDocumentUploaded,
  materializeImportDocument, matchImportSession, startImportProcessing, getImportSessions,
} from "@/lib/supabase/import-actions";
import { getImportReviewData, retryImportDocument, type ImportReviewData } from "@/lib/supabase/import-review-actions";
import { uploadImportDocument } from "@/lib/import/storage-client";
import { importFileIssue } from "@/lib/import/schemas";
import { processImportDocumentBatch } from "@/lib/import/batch-processing";
import { IMPORT_MAX_FILE_BYTES, IMPORT_V1_FORMATS, type ImportItemAction, type ImportSourceKind, type DatabaseImportDocument, type DatabaseImportItem, type DatabaseImportSession } from "@/lib/import/types";

const actions: Array<[ImportItemAction,string]> = [
  ["create","Créer"],["use_existing","Utiliser l’existant"],["update","Mettre à jour"],["ignore","Ignorer"],
];
const entityLabel = { category:"Catégorie", product:"Produit", customer:"Client", supplier:"Fournisseur" } as const;
const sessionLabel: Record<DatabaseImportSession["state"],string> = {
  collecting:"Collecte", processing:"Traitement", needs_review:"Revue", ready:"Prêt",
  importing:"Importation", completed:"Terminé", failed:"Échec", cancelled:"Annulé",
};
const docLabel: Record<DatabaseImportDocument["state"],string> = {
  uploading:"Upload", uploaded:"Prêt", parsing:"Lecture", parsed:"Lu",
  extracting:"Extraction", extracted:"Extrait", failed:"Échec",
};

function sourceKind(file: File): ImportSourceKind | null {
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const f = IMPORT_V1_FORMATS.find((x) => x.extension === ext);
  const mime = file.type.split(";")[0].trim().toLowerCase();
  if (!f) return null;
  const mimeTypes: readonly string[] = f.mimeTypes;
  return mimeTypes.includes(mime) ? f.sourceKinds[0] : null;
}
function bytes(n:number){return n < 1048576 ? `${Math.round(n/1024)} Ko` : `${(n/1048576).toFixed(1)} Mo`;}
function summary(item:DatabaseImportItem){
  return Object.entries(item.fields).map(([k,v])=>`${k}: ${v.raw}`).join(" · ");
}

export default function ImportPage(){
  const { permissions } = useOrg();
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [data,setData] = useState<ImportReviewData|null>(null);
  const [sessions,setSessions] = useState<DatabaseImportSession[]>([]);
  const [busy,setBusy] = useState("");
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [drafts,setDrafts] = useState<Record<string,{action:ImportItemAction; existingId:string|null}>>({});
  const [loading,setLoading] = useState(true);

  const load = useCallback(async(id:string)=>{
    setLoading(true); setError("");
    try{
      const d=await getImportReviewData(id); setData(d);
      setDrafts(old=>{
        const next={...old};
        d.items.forEach(i=>{if(!next[i.id]) next[i.id]={action:i.status==="ignored"?"ignore":i.action,existingId:i.match?.existing_id??null};});
        return next;
      });
    }catch(e){setError(e instanceof Error?e.message:"Erreur de chargement");}
    finally{setLoading(false);}
  },[]);

  useEffect(()=>{
    let dead=false;
    (async()=>{
      try{
        const rows=await getImportSessions(); if(dead)return;
        setSessions(rows);
        const id=new URLSearchParams(window.location.search).get("session");
        if(id) await load(id); else setLoading(false);
      }catch(e){if(!dead){setError(e instanceof Error?e.message:"Erreur de chargement");setLoading(false);}}
    })();
    return()=>{dead=true};
  },[load]);

  const open=(id:string)=>{router.replace(`/import?session=${encodeURIComponent(id)}`);void load(id);};
  const refresh=async()=>{if(data) await load(data.session.id);};

  async function newSession(){
    setBusy("new");setError("");setNotice("");
    try{const s=await createImportSession();setSessions(x=>[s,...x]);setData({session:s,documents:[],items:[],options:{category:[],product:[],customer:[],supplier:[]}});setDrafts({});router.replace(`/import?session=${s.id}`);}
    catch(e){setError(e instanceof Error?e.message:"Création impossible");}finally{setBusy("")}
  }

  async function filesSelected(files:FileList|null){
    if(!files||!data) return; setBusy("upload");setError("");setNotice("");
    try{
      for(const file of Array.from(files)){
        const kind=sourceKind(file);
        const issue=kind?importFileIssue(file.name,file.type,kind):"Format V1 non supporté";
        if(issue) throw new Error(issue);
        if(file.size===0) throw new Error(`${file.name}: fichier vide`);
        if(file.size>IMPORT_MAX_FILE_BYTES) throw new Error(`${file.name}: 25 Mo maximum`);
        const made=await addImportDocument({sessionId:data.session.id,originalName:file.name,sourceKind:kind as ImportSourceKind,mimeType:file.type,sizeBytes:file.size});
        try{await uploadImportDocument(file,made.storagePath);await markImportDocumentUploaded(made.document.id);}
        catch(e){try{await deleteImportDocument(made.document.id);}catch{};throw e;}
      }
      setNotice("Document(s) ajouté(s)."); await refresh();
    }catch(e){setError(e instanceof Error?e.message:"Erreur upload");await refresh();}
    finally{setBusy("");if(input.current)input.current.value=""}
  }

  async function process(){
    if(!data) return; setBusy("process");setError("");setNotice("");
    try{
      if(data.session.state==="collecting") await startImportProcessing(data.session.id);

      let d=await getImportReviewData(data.session.id);
      const pendingDocuments=d.documents.filter(x=>x.state==="uploaded");

      // Un document en échec ne doit jamais interrompre les autres :
      // chaque document est traité indépendamment et son état est persisté
      // par materializeImportDocument (SUCCESS → extracted, erreur → failed).
      const batch=await processImportDocumentBatch(
        pendingDocuments,
        (documentId)=>materializeImportDocument(documentId)
      );
      const successCount=batch.succeeded.length;
      const failedNames=batch.failed.map(x=>x.name);

      d=await getImportReviewData(data.session.id);
      if(d.session.state==="needs_review") d={...d,items:await matchImportSession(data.session.id)};
      setData(d);
      setSessions(x=>x.map(s=>s.id===d.session.id?d.session:s));

      if(failedNames.length===0){
        setNotice(
          pendingDocuments.length===0
            ? "Aucun document en attente de traitement."
            : `${successCount} document${successCount>1?"s":""} traité${successCount>1?"s":""}. Revue disponible.`
        );
      }else{
        setNotice(
          `${successCount}/${pendingDocuments.length} document${pendingDocuments.length>1?"s":""} traité${pendingDocuments.length>1?"s":""}. ${failedNames.length} en échec : ${failedNames.join(", ")}. Relancez uniquement les échecs.`
        );
      }
    }catch(e){setError(e instanceof Error?e.message:"Erreur de traitement");await refresh();}
    finally{setBusy("")}
  }

  async function decide(item:DatabaseImportItem){
    const d=drafts[item.id]; if(!d) return; setBusy(`d:${item.id}`);setError("");
    try{
      const updated=await decideImportItem({id:item.id,action:d.action,existingId:d.action==="use_existing"||d.action==="update"?d.existingId:null});
      setData(x=>x?{...x,items:x.items.map(i=>i.id===updated.id?updated:i)}:x);setNotice("Décision enregistrée.");
    }catch(e){setError(e instanceof Error?e.message:"Erreur décision");}finally{setBusy("")}
  }

  async function finalize(){if(!data)return;setBusy("finalize");setError("");
    try{const s=await finalizeImportReview(data.session.id);setData(x=>x?{...x,session:s}:x);setNotice("Revue finalisée : aucune écriture métier supplémentaire à ce stade.");}
    catch(e){setError(e instanceof Error?e.message:"Revue impossible");}finally{setBusy("")}
  }
  async function commit(){if(!data||!window.confirm("Confirmer l'import définitif ?"))return;setBusy("commit");setError("");
    try{
      const s=await commitImportSession(data.session.id);
      setData(x=>x?{...x,session:s}:x);
      const params=new URLSearchParams(window.location.search);
      const returnTo=params.get("returnTo");
      const returnStep=Number(params.get("step"));
      if(returnTo==="/onboarding"){
        const onboardingParams = new URLSearchParams();
        if(Number.isInteger(returnStep)&&returnStep>=1&&returnStep<=7){
          onboardingParams.set("step", String(returnStep));
        }
        onboardingParams.set("importSession", s.id);
        router.push("/onboarding?"+onboardingParams.toString());
        return;
      }
      setNotice("Import terminé.");
    }catch(e){setError(e instanceof Error?e.message:"Commit impossible");await refresh();}finally{setBusy("")}
  }
  async function cancel(){if(!data)return;setBusy("cancel");setError("");
    try{const s=await cancelImportSession(data.session.id);setData(x=>x?{...x,session:s}:x);setNotice("Import annulé.");}
    catch(e){setError(e instanceof Error?e.message:"Annulation impossible");}finally{setBusy("")}
  }
  async function retry(id:string){setBusy(`r:${id}`);setError("");
    try{await retryImportDocument(id);await refresh();setNotice("Document remis en attente de traitement.");}
    catch(e){setError(e instanceof Error?e.message:"Relance impossible");}finally{setBusy("")}
  }

  if(!permissions?.canManageOrganization) return <div className="max-w-2xl mx-auto"><Card><CardContent className="py-12 text-center"><ShieldCheck className="w-10 h-10 mx-auto text-muted"/><h1 className="font-display text-2xl font-bold text-ink mt-3">Import intelligent</h1><p className="text-sm text-muted mt-2">Accès réservé aux propriétaires et managers.</p></CardContent></Card></div>;
  if(loading&&!data) return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="w-7 h-7 animate-spin text-primary"/></div>;

  const pending=data?.items.filter(i=>i.status==="pending").length??0;
  const ready=!!data&&data.session.state==="needs_review"&&data.items.length>0&&pending===0;
  const opts=(item:DatabaseImportItem)=>data?.options[item.entity_type]??[];

  return <div className="max-w-7xl mx-auto space-y-6">
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
      <div>
        <p className="text-xs text-muted">UNYVON / Import intelligent</p>
        <h1 className="font-display text-2xl font-bold text-ink mt-1">Import intelligent</h1>
        <p className="text-sm text-muted mt-1 max-w-2xl">Déposez, contrôlez et validez vos données avant toute écriture métier.</p>
      </div>
      <div className="flex items-center gap-2">
        {new URLSearchParams(typeof window!=="undefined"?window.location.search:"").get("returnTo")==="/onboarding" && (
          <Button
            variant="outline"
            size="sm"
            onClick={()=>{const p=new URLSearchParams(window.location.search);const s=Number(p.get("step"));router.push("/onboarding"+(Number.isInteger(s)&&s>=1&&s<=7?"?step="+s:""));}}
            disabled={!!busy}
          >
            ← Retour à l&apos;onboarding
          </Button>
        )}
        {!data?<Button onClick={()=>void newSession()} disabled={!!busy}><FileUp className="w-4 h-4"/>{busy==="new"?"Création…":"Nouvel import"}</Button>:<Button variant="outline" size="sm" onClick={()=>{setData(null);setLoading(false);router.replace("/import")}} disabled={!!busy}>← Imports</Button>}
      </div>
    </div>
    {(error||notice)&&<div role={error?"alert":"status"} className={error?"p-3 rounded-[10px] bg-error/10 text-error text-sm":"p-3 rounded-[10px] bg-success/10 text-success text-sm"}><span className="flex items-center gap-2"><AlertCircle className="w-4 h-4"/>{error||notice}</span></div>}
    {!data?<Card variant="elevated"><CardHeader><h2 className="font-display font-semibold text-ink">Imports récents</h2></CardHeader><CardContent>{sessions.length===0?<p className="text-sm text-muted text-center py-8">Aucun import.</p>:<div className="space-y-2">{sessions.slice(0,12).map(s=><button key={s.id} type="button" onClick={()=>open(s.id)} className="w-full flex items-center gap-3 p-3 min-h-[56px] rounded-[12px] border border-border text-left hover:bg-background"><FileUp className="w-4 h-4 text-primary"/><span className="flex-1 text-sm text-ink">#{s.id.slice(0,8)}</span><Badge variant="info">{sessionLabel[s.state]}</Badge></button>)}</div>}</CardContent></Card>:
    <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
      <Card variant="elevated"><CardHeader><div className="flex items-center justify-between"><div><h2 className="font-display font-semibold text-ink">Documents</h2><p className="text-xs text-muted mt-1">PDF, DOC, DOCX, MD, JPG, PNG, WEBP · 25 Mo</p></div>{data.session.state==="collecting"&&<Button size="sm" onClick={()=>input.current?.click()} disabled={!!busy}><FileUp className="w-4 h-4"/>Ajouter</Button>}<input ref={input} className="sr-only" type="file" multiple accept=".pdf,.doc,.docx,.md,.jpg,.jpeg,.png,.webp" onChange={e=>void filesSelected(e.target.files)} aria-label="Fichiers à importer"/></div></CardHeader><CardContent className="space-y-3">{data.documents.length>1&&<div className="rounded-[10px] border border-border bg-background/60 p-3 text-xs text-muted">Chaque document est traité indépendamment : un échec n&apos;arrête plus le traitement des autres.</div>}{data.documents.map(d=><div key={d.id} className="border border-border rounded-[12px] p-3"><div className="flex gap-2 items-start"><FileUp className="w-4 h-4 text-primary mt-1"/><div className="flex-1 min-w-0"><p className="text-sm font-medium text-ink truncate">{d.original_name}</p><p className="text-xs text-muted">{d.source_kind.toUpperCase()} · {bytes(d.size_bytes)}</p></div><Badge variant={d.state==="failed"?"warning":d.state==="extracted"||d.state==="uploaded"?"success":"info"}>{docLabel[d.state]}</Badge></div>{d.error_message&&<p className="text-xs text-error mt-2">{d.error_message}</p>}<div className="flex flex-wrap gap-2 mt-2">{d.state==="failed"&&<Button size="sm" variant="outline" onClick={()=>void retry(d.id)} disabled={!!busy}><RefreshCw className="w-4 h-4"/>Relancer</Button>}{["uploading","uploaded","failed"].includes(d.state)&&<Button size="sm" variant="ghost" onClick={()=>void (async()=>{
  if(!window.confirm(`Supprimer « ${d.original_name} » de cet import ?`)) return;
  setBusy(`x:${d.id}`);setError("");setNotice("");
  try{await deleteImportDocument(d.id);await refresh();setNotice(`« ${d.original_name} » supprimé.`);}
  catch(e){setError(e instanceof Error?e.message:"Suppression impossible");}
  finally{setBusy("")}
})()} disabled={!!busy}><Trash2 className="w-4 h-4"/>Supprimer</Button>}</div></div>)}{data.documents.length===0&&<p className="text-sm text-muted text-center py-8">Ajoutez un fichier.</p>}{data.documents.length>0&&data.session.state==="collecting"&&<Button className="w-full" onClick={()=>void process()} disabled={!!busy||data.documents.some(d=>d.state==="uploading")}><Wand2 className="w-4 h-4"/>Lancer le traitement</Button>}{data.session.state!=="collecting"&&data.documents.some(d=>d.state==="uploaded")&&<Button className="w-full" variant="outline" onClick={()=>void process()} disabled={!!busy}><RefreshCw className="w-4 h-4"/>Reprendre le traitement</Button>}</CardContent></Card>
      <Card variant="elevated"><CardHeader><div className="flex items-center justify-between"><div><h2 className="font-display font-semibold text-ink">Revue</h2><p className="text-xs text-muted mt-1">{data.items.length} élément(s) · {pending} à traiter</p></div>{ready&&<Badge variant="success">Prêt</Badge>}</div></CardHeader><CardContent className="space-y-4">{data.items.length===0?<p className="text-sm text-muted text-center py-10">Aucun élément extrait.</p>:data.items.map(item=>{const draft=drafts[item.id]??{action:item.action,existingId:item.match?.existing_id??null};return <div key={item.id} className="border border-border rounded-[12px] p-4"><div className="flex flex-wrap gap-2 items-start justify-between"><div><Badge variant="info">{entityLabel[item.entity_type]}</Badge><p className="text-sm font-medium text-ink mt-2">{item.fields.name?.raw??"Nom absent"}</p><p className="text-xs text-muted mt-1 break-words">{summary(item)}</p></div>{item.match?.existing_name&&<p className="text-xs text-right text-muted">Proposé : <span className="font-medium text-ink">{item.match.existing_name}</span></p>}</div>{data.session.state==="needs_review"&&item.status!=="imported"&&<div className="mt-3 space-y-2"><div className="grid grid-cols-2 gap-2">{actions.map(([value,label])=><button key={value} type="button" className={draft.action===value?"min-h-[44px] rounded-[10px] border border-primary bg-lavender-soft text-primary text-xs":"min-h-[44px] rounded-[10px] border border-border text-muted text-xs"} onClick={()=>setDrafts(x=>({...x,[item.id]:{action:value,existingId:value==="use_existing"||value==="update"?(x[item.id]?.existingId??item.match?.existing_id??null):null}}))}>{label}</button>)}</div>{(draft.action==="use_existing"||draft.action==="update")&&<select aria-label="Cible existante" value={draft.existingId??""} onChange={e=>setDrafts(x=>({...x,[item.id]:{...x[item.id],existingId:e.target.value||null}}))} className="w-full rounded-[10px] border border-border bg-surface px-3 text-sm"><option value="">Sélectionner une cible…</option>{opts(item).map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select>}<Button size="sm" onClick={()=>void decide(item)} disabled={!!busy||((draft.action==="use_existing"||draft.action==="update")&&!draft.existingId)}>{busy===`d:${item.id}`?<Loader2 className="w-4 h-4 animate-spin"/>:<Check className="w-4 h-4"/>}Enregistrer</Button></div>}</div>})}{ready&&<Button className="w-full" onClick={()=>void finalize()} disabled={!!busy}>Finaliser la revue</Button>}{data.session.state==="ready"&&<Button className="w-full" onClick={()=>void commit()} disabled={!!busy}>{busy==="commit"?<Loader2 className="w-4 h-4 animate-spin"/>:<ShieldCheck className="w-4 h-4"/>}Importer définitivement</Button>}{data.session.state==="completed"&&<p className="text-sm text-success flex gap-2"><Check className="w-4 h-4"/>Import terminé.</p>}</CardContent></Card>
    </div>}
    {data&&!["completed","cancelled","importing"].includes(data.session.state)&&<div className="flex justify-end"><Button variant="ghost" size="sm" onClick={()=>void cancel()} disabled={!!busy}>Annuler l&apos;import</Button></div>}
  </div>;
}
