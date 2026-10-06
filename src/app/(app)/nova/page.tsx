"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
  CheckCircle2,
  History,
  Loader2,
  Plus,
  Sparkles,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  createNovaConversationAction,
  getLatestNovaConversationAction,
  getNovaMessagesAction,
  sendNovaMessageAction,
} from "@/lib/supabase/nova-chat-actions";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

const SUGGESTIONS = [
  "Pourquoi mes ventes évoluent-elles comme ça ?",
  "Quels produits dois-je surveiller en priorité ?",
  "Qui me doit le plus d'argent actuellement ?",
  "Où est-ce que je dépense le plus ?",
];

export default function NovaPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string | null>(null);
  const pendingConversationRef = useRef<Promise<string> | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const latest = await getLatestNovaConversationAction();
      if (cancelled) return;

      if (!latest.ok) {
        setError(latest.error);
        setLoadingHistory(false);
        return;
      }

      if (!latest.conversationId) {
        setLoadingHistory(false);
        inputRef.current?.focus();
        return;
      }

      setConversationId(latest.conversationId);
      conversationIdRef.current = latest.conversationId;
      setTitle(latest.title);

      const history = await getNovaMessagesAction(latest.conversationId);
      if (cancelled) return;

      if (!history.ok) {
        setError(history.error);
      } else {
        setMessages(history.messages);
      }

      setLoadingHistory(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const node = scrollRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, sending]);

  const startNewConversation = async () => {
    if (sending) return;

    setError("");
    setConversationId(null);
    conversationIdRef.current = null;
    setTitle(null);
    setMessages([]);

    const creation = createNovaConversationAction().then((result) => {
      if (!result.ok) {
        throw new Error(result.error);
      }
      return result.conversationId;
    });

    pendingConversationRef.current = creation;

    try {
      const newConversationId = await creation;
      conversationIdRef.current = newConversationId;
      setConversationId(newConversationId);
      inputRef.current?.focus();
    } catch (creationError) {
      setError(
        creationError instanceof Error
          ? creationError.message
          : "Impossible de créer une conversation NOVA"
      );
    } finally {
      if (pendingConversationRef.current === creation) {
        pendingConversationRef.current = null;
      }
    }
  };

  const send = async (event?: FormEvent) => {
    event?.preventDefault();
    const message = input.trim();

    if (!message || sending) return;

    setError("");
    setSending(true);
    setInput("");

    const optimistic: Message = {
      id: `local-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString(),
    };

    setMessages((current) => [...current, optimistic]);

    let targetConversationId = conversationIdRef.current;

    if (!targetConversationId && pendingConversationRef.current) {
      try {
        targetConversationId = await pendingConversationRef.current;
        conversationIdRef.current = targetConversationId;
        setConversationId(targetConversationId);
      } catch (creationError) {
        setError(
          creationError instanceof Error
            ? creationError.message
            : "Impossible de créer une conversation NOVA"
        );
        setSending(false);
        setMessages((current) =>
          current.filter((item) => item.id !== optimistic.id)
        );
        setInput(message);
        return;
      }
    }

    const result = await sendNovaMessageAction(targetConversationId, message);

    if (!result.ok) {
      setError(result.error);
      setSending(false);
      setMessages((current) =>
        current.filter((item) => item.id !== optimistic.id)
      );
      setInput(message);
      return;
    }

    conversationIdRef.current = result.conversationId;
    setConversationId(result.conversationId);
    if (!title) setTitle(message.slice(0, 80));

    setMessages((current) => [
      ...current,
      {
        id: result.message.id,
        role: "assistant",
        content: result.message.content,
        createdAt: result.message.createdAt,
      },
    ]);

    setSending(false);
    inputRef.current?.focus();
  };

  return (
    <div className="mx-auto flex h-[calc(100vh-6.5rem)] min-h-[600px] max-w-6xl flex-col gap-4">
      <section className="shrink-0 rounded-2xl border border-primary/15 bg-lavender-soft/60 p-4 md:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary text-white shadow-sm">
              <Sparkles className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-2xl font-bold text-ink">NOVA</h1>
                <span className="inline-flex items-center gap-1 rounded-full border border-primary/15 bg-background px-2 py-1 text-[10px] font-medium text-muted">
                  <CheckCircle2 className="h-3 w-3 text-success" />
                  Assistant IA
                </span>
              </div>
              <p className="text-sm text-muted">
                Analysez votre activité, posez une question et laissez NOVA chercher les chiffres utiles.
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link href="/insights">
              <Button variant="outline" size="sm">
                <History className="h-4 w-4" />
                Signaux
              </Button>
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={startNewConversation}
              disabled={sending}
            >
              <Plus className="h-4 w-4" />
              Nouvelle conversation
            </Button>
          </div>
        </div>
      </section>

      <Card
        variant="elevated"
        className="min-h-0 flex-1 overflow-hidden border-primary/15"
      >
        <div className="flex h-full min-h-0 flex-col">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-background/80 px-4 py-3 backdrop-blur md:px-5">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-lavender-soft">
                <Bot className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-ink">Conversation avec NOVA</p>
                <p className="text-[11px] text-muted">Vos données restent limitées à votre organisation.</p>
              </div>
            </div>
            <span className="hidden text-[11px] text-muted sm:inline">
              {messages.length > 0 ? `${messages.length} message${messages.length > 1 ? "s" : ""}` : "Prête à répondre"}
            </span>
          </div>

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 overflow-y-auto bg-surface/40 p-4 md:p-6"
            aria-live="polite"
          >
            {loadingHistory ? (
              <div className="flex h-full min-h-[260px] items-center justify-center text-sm text-muted">
                <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                Chargement de votre conversation…
              </div>
            ) : messages.length === 0 ? (
              <div className="mx-auto flex h-full min-h-[260px] max-w-3xl flex-col items-center justify-center text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 ring-8 ring-primary/5">
                  <Bot className="h-8 w-8 text-primary" />
                </div>
                <span className="rounded-full bg-background px-3 py-1 text-[11px] font-medium text-primary shadow-sm">
                  Votre copilote de gestion
                </span>
                <h2 className="mt-3 font-display text-2xl font-semibold text-ink">
                  Qu&apos;est-ce qui vous préoccupe aujourd&apos;hui ?
                </h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
                  Parlez naturellement à NOVA. Elle peut analyser vos ventes, votre stock,
                  vos créances, vos achats et vos dépenses avant de formuler une recommandation.
                </p>

                <div className="mt-6 grid w-full gap-2 sm:grid-cols-2">
                  {SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => {
                        setInput(suggestion);
                        inputRef.current?.focus();
                      }}
                      className="rounded-xl border border-border bg-background p-3 text-left text-xs text-ink shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex max-w-4xl flex-col gap-4">
                {title && (
                  <div className="text-center text-[11px] font-medium text-muted">
                    {title}
                  </div>
                )}

                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={
                      message.role === "user"
                        ? "flex justify-end"
                        : "flex justify-start"
                    }
                  >
                    <div
                      className={
                        message.role === "user"
                          ? "max-w-[88%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-sm leading-relaxed text-white shadow-sm md:max-w-[72%]"
                          : "max-w-[92%] rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3 text-sm leading-relaxed text-ink shadow-sm md:max-w-[78%]"
                      }
                    >
                      <div className="whitespace-pre-wrap">{message.content}</div>
                    </div>
                  </div>
                ))}

                {sending && (
                  <div className="flex justify-start">
                    <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3 text-xs text-muted shadow-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      NOVA analyse vos données…
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <CardContent className="shrink-0 border-t border-border bg-background p-3 md:p-4">
            {error && (
              <div className="mb-3 rounded-xl border border-error/20 bg-error/10 p-3 text-xs text-error">
                {error}
              </div>
            )}

            <form onSubmit={send} className="relative">
              <textarea
                ref={inputRef}
                data-testid="nova-message-input"
                value={input}
                onChange={(event) => setInput(event.target.value.slice(0, 4000))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Écrivez votre question à NOVA…"
                rows={2}
                disabled={sending || loadingHistory}
                className="min-h-[58px] w-full resize-none rounded-2xl border border-border bg-surface px-4 py-4 pr-28 text-sm text-ink outline-none transition focus:border-primary/40 focus:ring-4 focus:ring-primary/10 disabled:opacity-60"
                aria-label="Message à NOVA"
              />
              <Button
                type="submit"
                size="md"
                data-testid="nova-send-button"
                disabled={sending || loadingHistory || input.trim().length === 0}
                aria-label="Envoyer le message"
                className="absolute bottom-2 right-2"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ArrowUp className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">Envoyer</span>
              </Button>
            </form>

            <div className="mt-2 flex flex-col gap-1 text-[10px] text-muted sm:flex-row sm:items-center sm:justify-between">
              <p>
                NOVA utilise uniquement les données accessibles à votre organisation et ne déclenche pas d&apos;action métier sans validation humaine.
              </p>
              <p className="shrink-0">Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne</p>
            </div>
          </CardContent>
        </div>
      </Card>
    </div>
  );
}
