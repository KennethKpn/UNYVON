"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import {
  ArrowUp,
  Bot,
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
    const result = await createNovaConversationAction();

    if (!result.ok) {
      setError(result.error);
      return;
    }

    setConversationId(result.conversationId);
    setTitle(null);
    setMessages([]);
    inputRef.current?.focus();
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

    const result = await sendNovaMessageAction(conversationId, message);

    if (!result.ok) {
      setError(result.error);
      setSending(false);
      setMessages((current) => current.filter((item) => item.id !== optimistic.id));
      setInput(message);
      return;
    }

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
    <div className="max-w-5xl mx-auto flex flex-col gap-5 h-[calc(100vh-7rem)] min-h-[560px]">
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-[12px] bg-lavender-soft flex items-center justify-center">
            <Sparkles className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">NOVA</h1>
            <p className="text-sm text-muted">
              Votre assistant de gestion dans UNYVON
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/insights">
            <Button variant="outline" size="sm">
              <History className="w-4 h-4" />
              Signaux
            </Button>
          </Link>
          <Button variant="secondary" size="sm" onClick={startNewConversation} disabled={sending}>
            <Plus className="w-4 h-4" />
            Nouvelle conversation
          </Button>
        </div>
      </div>

      <Card variant="elevated" className="flex-1 min-h-0 flex flex-col overflow-hidden border-primary/15">
        <div
          ref={scrollRef}
          className="flex-1 min-h-0 overflow-y-auto p-5 md:p-6 space-y-5"
          aria-live="polite"
        >
          {loadingHistory ? (
            <div className="h-full flex items-center justify-center text-sm text-muted">
              <Loader2 className="w-5 h-5 animate-spin mr-2" />
              Chargement de votre conversation…
            </div>
          ) : messages.length === 0 ? (
            <div className="max-w-2xl mx-auto h-full flex flex-col items-center justify-center text-center">
              <div className="w-14 h-14 rounded-2xl bg-lavender-soft flex items-center justify-center mb-4">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <h2 className="font-display text-xl font-semibold text-ink">
                Parlons de votre activité.
              </h2>
              <p className="text-sm text-muted mt-2 max-w-xl leading-relaxed">
                NOVA peut analyser vos ventes, votre stock, vos créances, vos achats
                et vos dépenses. Posez votre question naturellement : il cherchera
                les données utiles avant de vous répondre.
              </p>

              <div className="grid sm:grid-cols-2 gap-2 mt-6 w-full">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      setInput(suggestion);
                      inputRef.current?.focus();
                    }}
                    className="text-left text-xs p-3 rounded-xl border border-border bg-background hover:bg-muted/40 transition-colors"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {title && (
                <div className="text-center text-xs text-muted pb-1">
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
                        ? "max-w-[85%] md:max-w-[70%] rounded-2xl rounded-br-md bg-primary text-white px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap"
                        : "max-w-[90%] md:max-w-[78%] rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3 text-sm text-ink leading-relaxed whitespace-pre-wrap"
                    }
                  >
                    {message.content}
                  </div>
                </div>
              ))}

              {sending && (
                <div className="flex justify-start">
                  <div className="rounded-2xl rounded-bl-md border border-border bg-background px-4 py-3 flex items-center gap-2 text-xs text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    NOVA analyse…
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <CardContent className="border-t border-border bg-surface">
          {error && (
            <div className="mb-3 p-3 rounded-xl bg-error/10 border border-error/20 text-xs text-error">
              {error}
            </div>
          )}

          <form onSubmit={send} className="flex items-end gap-2">
            <textarea
              ref={inputRef}
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
              className="min-h-[52px] max-h-40 flex-1 resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
              aria-label="Message à NOVA"
            />
            <Button
              type="submit"
              size="md"
              disabled={sending || loadingHistory || input.trim().length === 0}
              aria-label="Envoyer le message"
            >
              {sending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <ArrowUp className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">Envoyer</span>
            </Button>
          </form>

          <p className="text-[11px] text-muted mt-2">
            NOVA utilise les données de votre entreprise pour contextualiser ses réponses.
            Les actions métier restent sous validation humaine dans cette version.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
