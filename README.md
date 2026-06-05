# MemoryAI

**🌐 Język / Language:** [Polski](README.md) · [English](README.en.md)

---

**Warstwa trwałej pamięci i orkiestracji agentów dla modeli językowych.** Daje modelom AI (Claude, Gemini, GPT, Ollama) dostęp do faktów, decyzji i kontekstu z poprzednich sesji — i pozwala im **samodzielnie delegować zadania do innych modeli AI** bez żadnych kluczy API.

> "Dlaczego twoje AI zapomina wszystko, co wczoraj ustaliliście?" — MemoryAI rozwiązuje ten problem i idzie dalej: Claude może automatycznie wysłać zadanie do Gemini lub lokalnego Ollamy, zweryfikować wynik i działać dalej — bez żadnej akcji z Twojej strony.

![Self-hosted](https://img.shields.io/badge/self--hosted-yes-blue)
![PostgreSQL + pgvector](https://img.shields.io/badge/PostgreSQL-pgvector-4169e1)
![MCP + REST](https://img.shields.io/badge/MCP-REST%20API-green)
![Multi-agent](https://img.shields.io/badge/multi--agent-orchestration-orange)

### W skrócie — co robi MemoryAI

**🧠 Pamięć między sesjami** — Claude, Gemini czy GPT pamiętają Twoje decyzje, preferencje i kontekst projektów z poprzednich rozmów. Zero konfiguracji po stronie użytkownika — model wywołuje narzędzia MCP automatycznie.

**🤖 Orkiestracja agentów bez kluczy API** — lokalny serwer MCP `local-ai` daje Claude Code bezpośredni dostęp do:
- **Gemini** (2.5 Flash ~1s, 3.1 Pro ~4s) przez istniejącą sesję OAuth Antigravity
- **Ollama** (lokalnie na Dellu) — automatycznie wybiera model załadowany w VRAM
- **Claude subagent** — pełne możliwości agentowe z narzędziami (~2-5s)

Claude może samodzielnie: zdelegować code review do Gemini, poprosić Ollamę o analizę prywatnych danych, skrzyżować opinie kilku modeli — wszystko w jednym workflow, bez Twojego udziału.

**📊 Benchmark (zmierzone czasy):**
| Agent | Czas | Zastosowanie |
|-------|------|-------------|
| Gemini 2.5 Flash | ~1s | domyślny, szybkie zadania |
| Ollama/auto (VRAM) | ~1.5s | lokalne/prywatne dane |
| Claude subagent | ~2-5s | złożone, wymaga narzędzi |
| Gemini 3.1 Pro | ~4s | głęboka analiza |

---

## Spis treści

- [Funkcjonalności](#funkcjonalności)
- [Jak to działa](#jak-to-działa)
- [Orkiestracja multi-agent](#orkiestracja-multi-agent)
- [Szybki start](#szybki-start)
- [Integracja z IDE](#integracja-z-ide)
  - [Uniwersalny instalator](#uniwersalny-instalator)
  - [Ręczna konfiguracja per IDE](#ręczna-konfiguracja-per-ide)
- [Integracja z Open WebUI](#integracja-z-open-webui)
- [Dokumentacja narzędzi MCP](#dokumentacja-narzędzi-mcp)
- [Dokumentacja REST API](#dokumentacja-rest-api)
- [Konfiguracja](#konfiguracja)
- [Architektura](#architektura)
- [Struktura projektu](#struktura-projektu)
- [Wymagania systemowe](#wymagania-systemowe)
- [Szczegóły dystylacji](#szczegóły-dystylacji)
- [Bezpieczeństwo](#bezpieczeństwo)
- [Mapa drogowa](#mapa-drogowa)
- [Licencja](#licencja)

---

## Funkcjonalności

### Rdzeń systemu

- **Trwała pamięć dla dowolnego modelu językowego** — Claude, Gemini, GPT, Ollama oraz każdy model obsługujący MCP lub REST
- **PostgreSQL 16 + pgvector** — produkcyjna relacyjna baza danych z wyszukiwaniem wektorowym pierwszej klasy przez rozszerzenie pgvector
- **BullMQ + Redis** — niezawodna asynchroniczna kolejka zadań do dystylacji w tle; przeżywa restarty, automatycznie ponawia nieudane zadania
- **Serwer MCP** (HTTP + SSE, JSON-RPC 2.0) — kompatybilny z Claude Code, Cursor, VS Code, Windsurf, Continue.dev, Claude Desktop, Antigravity
- **REST API** — pełne CRUD dla wspomnień, sesji, encji i zarządzania kluczami API
- **Panel webowy** (w trakcie rozwoju) — przeglądanie wspomnień, wyszukiwanie, edycja, historia zadań dystylacji

### Pamięć

- **Sześć typów wspomnień**: `fact` (fakt), `decision` (decyzja), `preference` (preferencja), `instruction` (instrukcja), `entity_relation` (relacja encji), `summary` (podsumowanie)
- **Skala ważności** 0.0–1.0 — przypisywana przez model lub ręcznie; wpływa na ranking pobierania
- **Wyszukiwanie hybrydowe RRF** — Reciprocal Rank Fusion łączy ranking wektorowy (pgvector cosine) + ranking tekstowy (tsvector + pg_trgm trigram) + mały boost ważności; lepsze niż ważona suma surowych wyników, szczególnie dla zapytań wielojęzycznych PL/EN
- **Nazwane encje** — ustrukturyzowane wpisy grafu wiedzy z kategoryzowanymi typami: `person` (osoba), `project` (projekt), `company` (firma), `system`, `tool` (narzędzie), `server` (serwer), `other` (inne)
- **Fakty encji** — każda encja gromadzi stwierdzenia faktyczne z wielu sesji (upsert po nazwie)
- **Przypięte wspomnienia** — oznacz wspomnienia jako przypięte, aby zawsze były dołączane do kontekstu niezależnie od wyniku trafności
- **Tagi wspomnień** — dowolne etykiety tekstowe do filtrowania i grupowania

### Dystylacja

- **Automatyczna dystylacja** wyzwalana po 15 minutach bezczynności sesji (konfigurowalne)
- **Wyzwalacz oparty na liczbie wiadomości** — uruchamia się również po każdych N wiadomościach, jeśli skonfigurowane
- **Ekstrakcja sterowana przez LLM** — model dystylacji czyta pełną surową rozmowę i wyodrębnia ustrukturyzowane fakty, decyzje, preferencje, instrukcje i relacje encji
- **Trzech obsługiwanych dostawców dystylacji**:
  - **Ollama** — w pełni lokalny i prywatny, bez klucza API, działa offline
  - **Gemini** (przez klucz API) — szybki, niski koszt na sesję
  - **Anthropic** (przez klucz API) — najwyższa jakość ustrukturyzowanego wyjścia
- **Worker BullMQ** uruchamia się co minutę i przetwarza zaległe sesje z kolejki Redis
- **Konsolidacja temporalna** (tygodniowo) — scala podobne wspomnienia, aby zapobiec redundancji
- **Deduplikacja** (tygodniowo) — automatycznie usuwa dokładne i prawie identyczne wspomnienia

### Orkiestracja multi-agent

- **Serwer MCP `local-ai`** (`integrations/claude-code/mcp-local-ai.py`) — daje Claude Code i innym agentom AI bezpośredni dostęp do wielu modeli jednocześnie
- **`ask_gemini`** — wysyła zapytanie do Gemini przez sesję OAuth Antigravity, bez klucza API
- **`ask_model`** — wysyła zapytanie do dowolnego modelu dostępnego w podłączonym serwerze językowym Antigravity
- **`ask_ollama`** — wysyła zapytanie do lokalnych modeli Ollama na skonfigurowanym serwerze
- **`list_ai_models`** — listuje wszystkie modele Gemini/Claude/GPT dostępne przez Antigravity
- **`list_ollama_models`** — listuje wszystkie lokalnie dostępne modele Ollama
- **Automatyczne wykrywanie tokenu CSRF bez konfiguracji** — serwer MCP czyta `/proc` w czasie działania, aby znaleźć port serwera językowego Antigravity i token CSRF; brak zakodowanych na stałe wartości, automatycznie przeżywa każdy restart
- **Narzędzie CLI `ask-model.py`** — wywołaj dowolny model bezpośrednio z terminala, z obsługą stdin i trybem wyjścia JSON

### Integracje z IDE

- Cursor, VS Code, Windsurf, Continue.dev, Claude Desktop, Antigravity, Claude Code (CLI)
- **Uniwersalny instalator Python** — automatycznie wykrywa wszystkie zainstalowane IDE i zapisuje konfigurację MCP dla każdego; działa na Linux, macOS, Windows bez żadnych zależności poza Python 3
- Serwowany przez MemoryAI pod adresem `/dashboard/install.py` — zawsze aktualny

### Integracja z Open WebUI

- **`memoryai_filter.py`** — globalny filtr, który automatycznie wstrzykuje odpowiednie wspomnienia do systemowego promptu każdej rozmowy; nie wymaga świadomości po stronie modelu
- **`memoryai_tools.py`** — jawne narzędzia, które model może wywoływać na żądanie: `memory_search`, `memory_save`, `entity_get`, `entity_save`, `memory_get_context`
- Zero konfiguracji dla końcowych użytkowników: filtr uruchamia się automatycznie przy każdej wiadomości

### Zdalny dostęp

- **Tailscale Serve** — udostępnij MemoryAI wyłącznie swojej sieci tailnet
- **Tailscale Funnel** — publiczny punkt końcowy HTTPS bez konieczności zarządzania certyfikatami

### Bezpieczeństwo

- Uwierzytelnianie tokenem Bearer na każdym punkcie końcowym REST i MCP
- Ograniczanie liczby żądań per klucz API przez `@fastify/rate-limit` (domyślnie 10 000 RPM, konfigurowalne)
- Nagłówki bezpieczeństwa `@fastify/helmet` (CSP, HSTS, X-Frame-Options, itp.)
- CORS ograniczony do jawnie dozwolonych źródeł
- Sparametryzowane zapytania SQL wszędzie — brak interpolacji ciągów, brak powierzchni ataku SQL injection
- Walidacja wejścia Zod na wszystkich punktach końcowych REST i argumentach narzędzi MCP
- Wszystkie zapytania bazodanowe ograniczone do `user_id` — pełna izolacja danych między użytkownikami
- Szyfrowanie AES-256-GCM dostępne dla wspomnień kategorii credential (`ENCRYPTION_KEY`)

---

## Jak to działa

Modele językowe są **bezstanowe** — każda sesja zaczyna od zera. MemoryAI dodaje warstwę trwałej pamięci między twoim IDE/agentem a modelem:

```
┌──────────────────────────────────────────────────────────────┐
│    TWOJE IDE / AGENT  (Claude Code, Cursor, Open WebUI)      │
│  Model widzi narzędzia MCP → wywołuje je automatycznie       │
└─────────────────────────┬────────────────────────────────────┘
                          │  MCP (HTTP/SSE, JSON-RPC 2.0)
                          │  lub REST API
┌─────────────────────────▼────────────────────────────────────┐
│          Serwer MemoryAI  (Node.js 20 + Fastify 5)           │
│                                                              │
│  ① start sesji    →  memory_get_context()                    │
│     zwraca top-K trafnych wspomnień → wstrzykuje do kontekstu│
│                                                              │
│  ② podczas sesji  →  memory_save() / entity_save()           │
│     model zapisuje fakty, decyzje, preferencje               │
│                                                              │
│  ③ koniec sesji   →  session_end()                           │
│     kolejkuje dystylację w tle całej rozmowy                 │
└────────┬────────────────────────┬────────────────────────────┘
         │                        │
┌────────▼──────────┐   ┌─────────▼──────────────┐
│   PostgreSQL 16   │   │   Redis 7               │
│   + pgvector 0.7  │   │   kolejka zadań BullMQ  │
│                   │   │   cache stanu sesji     │
│   wspomnienia     │   └─────────────────────────┘
│   sesje           │             │
│   encje           │   ┌─────────▼──────────────┐
│   użytkownicy     │   │   Worker dystylacji     │
│   projekty        │   │   (BullMQ, co 1 min)   │
└───────────────────┘   │                        │
                        │   ┌────────────────┐   │
                        │   │  Model LLM     │   │
                        │   │  Ollama        │   │
                        │   │  Gemini Flash  │   │
                        │   │  Claude Haiku  │   │
                        │   └────────────────┘   │
                        └────────────────────────┘
```

### Automatyczny przepływ pamięci — zero wysiłku użytkownika

| Krok | Co się dzieje | Kto to wyzwala |
|------|---------------|----------------|
| Rozmowa startuje | `memory_get_context` wywołane → top-K trafnych wspomnień wstrzykniętych do kontekstu | Model (auto przez opis narzędzia MCP) |
| W trakcie rozmowy | `memory_save`, `entity_save` wywoływane, gdy pojawiają się ważne fakty | Model (autonomiczna ocena) |
| Sesja bezczynna 15 min | Timer bezczynności odpala → sesja kolejkowana do dystylacji | Serwer (automatycznie, bez działania użytkownika) |
| Worker pobiera zadanie | LLM czyta całą sesję → wyodrębnia ustrukturyzowane wspomnienia + encje | Worker BullMQ (w tle) |
| Następna rozmowa | Model ma pełny kontekst z poprzednich sesji automatycznie | — |

### Wyszukiwanie hybrydowe

Wspomnienia są pobierane przez **Reciprocal Rank Fusion (RRF)** — standardową technikę łączenia wyników z wielu źródeł przez rankingi, nie surowe wyniki. Wszystko obliczane w jednym zapytaniu PostgreSQL bez dodatkowych przejazdów sieciowych:

| Sygnał | Metoda | Rola w RRF |
|--------|--------|-----------|
| Podobieństwo semantyczne | Odległość cosinusowa przez pgvector (`<=>`) | Ranking wektorowy |
| Dopasowanie pełnotekstowe | `tsvector` (simple + english) + trigram (`pg_trgm`) | Ranking tekstowy |
| Ważność + recency | Zdefiniowane przez użytkownika lub LLM (0.0–1.0) | Mały boost do RRF score |

RRF łączy oba rankingi wzorem `1/(k + rank_vector) + 1/(k + rank_text)` (k=60, standard branżowy). Dzięki temu wspomnienie które jest na miejscu #1 wektorowo i #15 tekstowo wygrywa z takim które jest #5 i #5 — co odpowiada intuicji lepiej niż ważona suma surowych wyników.

---

## Orkiestracja multi-agent

To jedna z najbardziej wyróżniających funkcji MemoryAI: nie tylko pamięć, ale **aktywna orkiestracja wielomodelowa**. Claude Code (lub dowolny agent) może delegować podzadania do Gemini, sprawdzać odpowiedzi z innym modelem, lub używać lokalnego modelu Ollama dla zadań wymagających prywatności — wszystko w tej samej rozmowie, bez kluczy API.

### Serwer MCP `local-ai`

Zlokalizowany w `integrations/claude-code/mcp-local-ai.py`, jest to **serwer MCP stdio** udostępniający pięć narzędzi:

| Narzędzie | Co robi |
|-----------|---------|
| `ask_gemini` | Wysyła prompt do Gemini (domyślnie: `gemini-2.5-flash`). Używa OAuth Antigravity — bez klucza API. |
| `ask_model` | Wysyła prompt do dowolnego modelu podłączonego do serwera językowego Antigravity (Gemini, Claude, GPT). |
| `ask_ollama` | Wysyła prompt do lokalnego modelu Ollama na skonfigurowanym serwerze. |
| `list_ai_models` | Zwraca wszystkie modele Gemini/Claude/GPT dostępne przez Antigravity. |
| `list_ollama_models` | Zwraca wszystkie modele Ollama dostępne na lokalnym serwerze Ollama. |

### Jak działa wykrywanie tokenu CSRF

Antigravity (fork VS Code / Windsurf firmy Codeium) uruchamia lokalny proces serwera językowego — `language_server_linux_x64` — który jest już uwierzytelniony przez Google OAuth. Ten serwer językowy udostępnia API ConnectRPC na lokalnym porcie HTTPS.

Serwer MCP `local-ai` odkrywa zarówno port, jak i token CSRF **w czasie działania** poprzez parsowanie wyjścia `/proc` (przez `ps aux`):

```
Krok 1: ps aux | grep language_server_linux_x64
Krok 2: wyodrębnij --csrf_token <uuid> z argumentów procesu
Krok 3: sprawdź znane porty [44751, 43951, 43337, 43205] wywołaniem Heartbeat
Krok 4: buforuj (csrf, port) na czas trwania sesji MCP
Krok 5: przy każdym błędzie, automatycznie ponów wykrywanie
```

Oznacza to:
- Brak zakodowanych na stałe portów ani tokenów w żadnym pliku konfiguracyjnym
- Przeżywa restarty Antigravity (token i port zmieniają się przy każdym restarcie, ale są ponownie wykrywane przy następnym wywołaniu)
- Działa nawet jeśli port zmienia się między maszynami

### Diagram przepływu wywołania

```
Claude Code CLI
  │
  ├─ czyta wiadomość użytkownika, decyduje zapytać Gemini
  │
  └─► wywołanie narzędzia MCP: mcp__local-ai__ask_gemini
        │  prompt="Przejrzyj ten diff PR pod kątem problemów bezpieczeństwa"
        │  model="gemini-3.1-pro-high"
        │
        └─► mcp-local-ai.py (serwer MCP stdio)
              │
              ├─► ps aux → znajdź language_server_linux_x64
              ├─► wyodrębnij csrf_token
              ├─► sprawdź port 44751 → Heartbeat OK
              │
              └─► ConnectRPC POST do 127.0.0.1:44751
                    ścieżka: /exa.language_server_pb.LanguageServerService/GetModelResponse
                    nagłówki:
                      x-codeium-csrf-token: <uuid>
                      Content-Type: application/json
                      Connect-Protocol-Version: 1
                    treść: {"prompt": "...", "model": "MODEL_PLACEHOLDER_M37"}
                    │
                    └─► Serwer językowy Antigravity
                          │
                          └─► Google Cloud AI (przez istniejące OAuth)
                                │
                                └─► odpowiedź strumieniowana z powrotem do Claude Code
```

```
Claude Code CLI
  │
  └─► wywołanie narzędzia MCP: mcp__local-ai__ask_ollama
        │  prompt="Wyjaśnij ten algorytm krok po kroku"
        │  model="qwen2.5:14b"
        │
        └─► mcp-local-ai.py
              │
              └─► HTTP POST do http://100.99.158.2:11434/api/generate
                    treść: {"model": "qwen2.5:14b", "prompt": "...", "stream": false}
                    │
                    └─► Ollama (lokalnie, serwer Dell)
                          └─► wnioskowanie działa lokalnie, bez internetu
                                └─► odpowiedź zwrócona do Claude Code
```

### Instalacja

Dodaj serwer MCP `local-ai` do pliku `.mcp.json` projektu (lub do globalnego `~/.claude/settings.json`):

```json
{
  "mcpServers": {
    "local-ai": {
      "type": "stdio",
      "command": "python3",
      "args": ["/path/to/memoryai/integrations/claude-code/mcp-local-ai.py"]
    }
  }
}
```

Po przeładowaniu IDE lub restarcie Claude Code, dostępne stają się następujące narzędzia:

```
mcp__local-ai__ask_gemini          Zapytaj Gemini przez OAuth (bez klucza API)
mcp__local-ai__ask_model           Zapytaj dowolny model podłączony przez Antigravity
mcp__local-ai__ask_ollama          Zapytaj lokalny model Ollama
mcp__local-ai__list_ai_models      Lista dostępnych modeli Gemini/Claude/GPT
mcp__local-ai__list_ollama_models  Lista dostępnych lokalnych modeli Ollama
```

**Wymagania:**
- Antigravity (VS Code / Windsurf z rozszerzeniem Codeium) musi być uruchomiony i uwierzytelniony
- Dla `ask_ollama`: Ollama musi działać pod skonfigurowanym `OLLAMA_URL`
- Python 3.8+ (bez zewnętrznych pakietów — używa tylko biblioteki standardowej)

### Dostępne modele przez local-ai

#### Modele w chmurze (przez OAuth Antigravity — bez klucza API)

| Alias | Opis | Najlepszy do |
|-------|------|--------------|
| `gemini-2.5-flash` | Domyślny — szybki i darmowy | Ogólne zapytania, szybka analiza |
| `gemini-2.5-flash-lite` | Lżejszy wariant | Ultra-szybki, minimalne zadania |
| `gemini-2.5-flash-thinking` | Tryb rozumowania | Problemy wieloetapowe, matematyka |
| `gemini-2.5-pro` | Poziom Pro | Głęboka analiza (może mieć limity pojemności) |
| `gemini-3.1-flash-lite` | Nowa generacja light | Szybkie zapytania |
| `gemini-3.1-pro-low` | Nowa generacja Pro, ekonomiczny | Solidna ogólna inteligencja |
| `gemini-3.1-pro-high` | Nowa generacja Pro, pełny | Najlepsza ogólna jakość |
| `gemini-3.5-flash-medium` | Seria Flash | Zrównoważona szybkość/jakość |
| `gemini-3.5-flash-high` | Seria Flash, wysoka jakość | Wyższa jakość, nadal szybki |
| `claude-sonnet-4-6` | Claude Sonnet 4.6 | Kod, rozumowanie, pisanie |
| `claude-opus-4-6-thinking` | Claude Opus z myśleniem | Złożone rozumowanie, architektura |
| `gpt-oss-120b` | GPT OSS 120B | Alternatywna perspektywa |

#### Lokalne modele przez Ollama

| Model | Wymagana RAM | Najlepszy do |
|-------|-------------|--------------|
| `qwen3.5:4b` | 3 GB | Domyślny szybki model, codzienne zadania |
| `qwen2.5:7b` | 4.7 GB | Ogólne rozumowanie, dobry dla języka polskiego |
| `qwen2.5:14b` | 9 GB | Wysokiej jakości lokalne wnioskowanie |
| `llama3.1:8b` | 5 GB | Ogólne zastosowanie, angielski |
| `deepseek-coder-v2:16b` | 10 GB | Generowanie i przegląd kodu |
| `codestral:22b` | 14 GB | Zaawansowane zadania z kodem |
| `mistral:latest` | 4.1 GB | Europejski model, wielojęzyczny |
| `mistral-nemo:latest` | 7 GB | Lepsze rozumowanie niż bazowy Mistral |
| `llama3.2-vision:11b` | 8 GB | Zadania z wizją i obrazami |

### Przewodnik wyboru modelu

| Zadanie | Zalecany model | Powód |
|---------|----------------|-------|
| Ogólna analiza i wiedza | `gemini-2.5-flash` | Szybki, darmowy, bardzo zdolny |
| Głębokie rozumowanie / architektura | `gemini-3.1-pro-high` | Najlepsza jakość dostępna przez OAuth |
| Złożone problemy wieloetapowe | `gemini-2.5-flash-thinking` lub `claude-opus-4-6-thinking` | Włączony tryb rozumowania |
| Przegląd kodu | `gemini-3.1-pro-high` lub `deepseek-coder-v2:16b` (Ollama) | Silne zrozumienie kodu |
| Generowanie kodu | `deepseek-coder-v2:16b` lub `codestral:22b` | Wyspecjalizowane modele kodu |
| Zadania wrażliwe na prywatność | Dowolny model Ollama | Nigdy nie opuszcza twojej maszyny |
| Szybkie lokalne wnioskowanie | `qwen3.5:4b` | 3 GB RAM, poniżej sekundy na GPU |
| Treści polskie/wielojęzyczne | `qwen2.5:14b` lub `bge-m3` | Wytrenowane na danych wielojęzycznych |
| Druga opinia / weryfikacja | Inny model niż pierwszy | Inne wytrenowanie → inne błędy |
| Wizja / multimodalne | `llama3.2-vision:11b` lub `qwen2.5vl:7b` | Potrafi przetwarzać obrazy |

### Przykładowe przepływy pracy

#### Przepływ 1: Claude deleguje przegląd bezpieczeństwa PR do Gemini

```
Użytkownik: "Sprawdź bezpieczeństwo tego PR"

Claude:
  1. Czyta diff PR (przez narzędzia gh CLI lub odczytu pliku)
  2. Wywołuje mcp__local-ai__ask_gemini z:
       prompt = "Przegląd bezpieczeństwa tego diffu: [zawartość diffu]"
       model = "gemini-3.1-pro-high"
       system = "Jesteś starszym inżynierem bezpieczeństwa. Znajdź injection, obejście auth i problemy z ujawnianiem danych."
  3. Otrzymuje analizę bezpieczeństwa od Gemini
  4. Syntezuje wyniki z własną analizą
  5. Wywołuje mcp__memoryai__memory_save z kluczowymi wynikami jako wspomnienie typu 'decision'
  6. Zwraca połączony raport użytkownikowi
```

#### Przepływ 2: Claude używa Ollama do prywatnej analizy kodu

```
Użytkownik: "Przeanalizuj algorytm w tym pliku — zachowaj prywatność"

Claude:
  1. Czyta zawartość pliku
  2. Wywołuje mcp__local-ai__ask_ollama z:
       prompt = "Przeanalizuj złożoność czasową/przestrzenną i zaproponuj optymalizacje: [kod]"
       model = "qwen2.5:14b"
       system = "Jesteś ekspertem od algorytmów."
  3. Analiza działa 100% lokalnie na serwerze Dell — nigdy nie jest wysyłana do żadnej chmury
  4. Zwraca analizę użytkownikowi
```

#### Przepływ 3: Claude orkiestruje wielomodelowy konsensus

```
Użytkownik: "Jakiej bazy danych powinienem użyć do tego projektu?"

Claude:
  1. Wywołuje mcp__local-ai__ask_gemini — otrzymuje rekomendację Gemini
  2. Wywołuje mcp__local-ai__ask_model z model="claude-sonnet-4-6" — otrzymuje opinię innego Claude
  3. Porównuje dwie odpowiedzi pod kątem zgodności/niezgodności
  4. Syntezuje rekomendację
  5. Zapisuje decyzję w MemoryAI:
       mcp__memoryai__memory_save({
         content: "Zdecydowano użyć PostgreSQL — rekomendowane przez Gemini i Claude",
         type: "decision",
         importance: 0.9
       })
```

### Narzędzie CLI: `ask-model.py`

Do szybkich wywołań modelu z terminala bez potrzeby IDE:

```bash
# Podstawowe użycie — pyta Gemini 2.5 Flash (domyślny)
python3 integrations/claude-code/ask-model.py "Wyjaśnij to wyrażenie regularne: ^[a-z]{3,}$"

# Wskaż inny model
python3 integrations/claude-code/ask-model.py "Przejrzyj tę funkcję" --model gemini-3.1-pro-high

# Dodaj systemowy prompt dla wyspecjalizowanego zachowania
python3 integrations/claude-code/ask-model.py \
  "Przejrzyj ten diff pod kątem problemów bezpieczeństwa" \
  --model gemini-3.1-pro-high \
  --system "Jesteś starszym inżynierem bezpieczeństwa skupionym na OWASP Top 10"

# Czytaj prompt ze stdin (przydatne w pipeline'ach)
git diff HEAD~1 | python3 integrations/claude-code/ask-model.py --model gemini-2.5-flash

# Wylistuj wszystkie dostępne modele
python3 integrations/claude-code/ask-model.py --list-models

# Wyjście jako JSON (do skryptowania)
python3 integrations/claude-code/ask-model.py "Podsumuj to" --json

# Ustaw niestandardowy timeout dla wolnych modeli
python3 integrations/claude-code/ask-model.py "Złożone pytanie" \
  --model claude-opus-4-6-thinking \
  --timeout 120
```

**Wszystkie flagi CLI:**

| Flaga | Skrót | Domyślna | Opis |
|-------|-------|----------|------|
| `--model` | `-m` | `gemini-2.5-flash` | Alias modelu do użycia |
| `--system` | `-s` | — | Systemowy prompt |
| `--list-models` | `-l` | — | Lista wszystkich dostępnych modeli i wyjście |
| `--timeout` | `-t` | `30` | Timeout w sekundach |
| `--json` | — | — | Wyjście `{"model": "...", "response": "..."}` jako JSON |

---

## Szybki start

### 1. Sklonuj i uruchom setup

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
```

Skrypt `setup.sh` wykonuje następujące czynności automatycznie:

- Generuje `.env` z kryptograficznie losowymi sekretami (przez `openssl rand`)
- Uruchamia PostgreSQL 16 + pgvector i Redis 7 przez Docker Compose
- Uruchamia migracje bazy danych i tworzy wszystkie tabele, indeksy i funkcje wyszukiwania
- Wykrywa zainstalowane modele Ollama i konfiguruje najlepszy dostępny dla embeddingów i dystylacji
- Zapisuje konfigurację MCP do Antigravity (`~/.gemini/antigravity/mcp_config.json`), jeśli zainstalowany
- Zapisuje konfigurację MCP do Claude Code (`~/.claude/settings.json`), jeśli zainstalowany

### 2. Uruchom serwer

```bash
# Zalecane: Docker Compose — zawiera PostgreSQL i Redis
docker compose -f docker/docker-compose.yml up -d

# Lokalne środowisko deweloperskie (PostgreSQL i Redis muszą działać oddzielnie)
npm install
npm run dev -w packages/api
```

### 3. Zweryfikuj, że serwer działa

```bash
curl http://localhost:3001/health
# Oczekiwane: {"status":"ok","version":"0.1.0","timestamp":"2026-06-04T..."}
```

### 4. Podłącz swoje IDE

Najszybszy sposób to uniwersalny instalator (patrz [Integracja z IDE](#integracja-z-ide)):

```bash
# Linux / macOS — automatycznie wykrywa wszystkie zainstalowane IDE
curl -sL http://localhost:3001/dashboard/install.py | python3

# Lub dodaj ręcznie do ~/.claude/settings.json (Claude Code)
```

Po przeładowaniu IDE model AI automatycznie ma dostęp do wszystkich sześciu narzędzi pamięci i zacznie budować trwałą pamięć od pierwszej rozmowy.

### 5. Przetestuj narzędzia pamięci

Zapytaj swoje AI:

```
"Zapamiętaj, że preferuję TypeScript strict mode we wszystkich projektach."
```

Następnie zacznij nową rozmowę i zapytaj:

```
"Jakie są moje preferencje dotyczące kodowania?"
```

Model pobierze wcześniej zapisaną preferencję przez `memory_get_context` automatycznie.

---

## Integracja z IDE

### Uniwersalny instalator

Jeden skrypt Python automatycznie wykrywa wszystkie zainstalowane IDE i zapisuje odpowiednią konfigurację MCP dla każdego. Działa na Linux, macOS i Windows bez żadnych zależności poza Python 3.

**Linux / macOS:**
```bash
curl -sL http://localhost:3001/dashboard/install.py | python3
```

**Windows (PowerShell):**
```powershell
python3 -c "import urllib.request; exec(urllib.request.urlopen('http://localhost:3001/dashboard/install.py').read())"
```

Zamień `localhost:3001` na swój host MemoryAI (np. URL Tailscale Funnel dla zdalnego dostępu).

**Flagi instalatora:**

| Flaga | Opis |
|-------|------|
| `--force` | Nadpisz istniejące wpisy MCP MemoryAI bez pytania |
| `--check` | Uruchomienie testowe — wykryj IDE i pokaż co zostałoby zapisane, bez wprowadzania zmian |
| `--list` | Wykryj zainstalowane IDE, wydrukuj ścieżki ich konfiguracji i wyjdź |

**Przykład z flagami:**
```bash
# Sprawdź co instalator zrobiłby, bez zapisywania czegokolwiek
curl -sL http://localhost:3001/dashboard/install.py | python3 -- --check

# Wymuś nadpisanie wszystkich istniejących konfiguracji
curl -sL http://localhost:3001/dashboard/install.py | python3 -- --force
```

Instalator czyta twój klucz API z serwera MemoryAI i zapisuje go (w nagłówku `Authorization: Bearer`) do pliku konfiguracyjnego każdego wykrytego IDE. Ścieżki konfiguracji są świadome platformy:

| IDE | Linux | macOS | Windows |
|-----|-------|-------|---------|
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` |
| VS Code | `~/.config/Code/User/mcp.json` | `~/Library/Application Support/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` |
| Windsurf | `~/.windsurf/mcp.json` | `~/.windsurf/mcp.json` | `%USERPROFILE%\.windsurf\mcp.json` |
| Continue.dev | `~/.continue/config.json` | `~/.continue/config.json` | `%USERPROFILE%\.continue\config.json` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` |
| Antigravity | `~/.gemini/antigravity/mcp_config.json` | `~/.gemini/antigravity/mcp_config.json` | — |
| Claude Code (CLI) | `~/.claude/settings.json` | `~/.claude/settings.json` | `%USERPROFILE%\.claude\settings.json` |

---

### Ręczna konfiguracja per IDE

Wszystkie ręczne konfiguracje wymagają twojego klucza API. Pobierz go z `.env` (`ADMIN_API_KEY`) lub wygeneruj nowy przez REST API.

#### Cursor

`~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### VS Code (z rozszerzeniem MCP)

`~/.config/Code/User/mcp.json` (Linux) lub `%APPDATA%\Code\User\mcp.json` (Windows):
```json
{
  "servers": {
    "memoryai": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Windsurf

`~/.windsurf/mcp.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "serverUrl": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Continue.dev

Dodaj do tablicy `mcpServers` w `~/.continue/config.json`:
```json
{
  "mcpServers": [
    {
      "name": "memoryai",
      "transport": {
        "type": "http",
        "url": "http://localhost:3001/mcp",
        "headers": {
          "Authorization": "Bearer YOUR_API_KEY"
        }
      }
    }
  ]
}
```

#### Claude Desktop

Ścieżka specyficzna dla platformy:
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Antigravity (Google Codeium)

`~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "serverUrl": "http://localhost:3001/mcp/sse",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

Uwaga: Antigravity używa punktu końcowego SSE (`/mcp/sse`) zamiast standardowego punktu końcowego HTTP.

#### Claude Code (CLI)

`~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_API_KEY"
      }
    }
  }
}
```

#### Pobierz gotowe do wklejenia fragmenty konfiguracji przez API

```bash
curl -H "Authorization: Bearer YOUR_API_KEY" \
  http://localhost:3001/mcp/config
```

Zwraca obiekt JSON z gotowymi do wklejenia fragmentami konfiguracji dla wszystkich obsługiwanych IDE.

---

### Zdalny dostęp przez Tailscale

MemoryAI może być bezpiecznie udostępniony przez HTTPS przy użyciu Tailscale Funnel, co czyni go dostępnym z dowolnej maszyny — domu, laptopa służbowego, telefonu lub zdalnego agenta — bez klienta VPN.

```bash
# Udostępnij tylko swojej sieci Tailnet (prywatnie)
tailscale serve --bg 3001

# Udostępnij publicznie przez HTTPS (Tailscale Funnel)
tailscale funnel --bg 3001
```

Po uruchomieniu tych poleceń, twój serwer MemoryAI jest dostępny pod adresem:

```
https://your-device.tailfbeb53.ts.net/mcp
```

Użyj tego URL zamiast `http://localhost:3001/mcp` we wszystkich konfiguracjach IDE. TLS jest terminowany przez infrastrukturę Tailscale — nie potrzeba zarządzania certyfikatami.

Przypadki użycia:
- Współdzielony serwer pamięci dostępny z wielu maszyn
- Dostęp do swoich wspomnień z urządzenia mobilnego lub zdalnego agenta
- Uruchom MemoryAI na serwerze domowym i używaj go ze swojego laptopa gdziekolwiek

**Uwaga dotycząca bezpieczeństwa:** Tailscale Funnel sprawia, że punkt końcowy jest publicznie routowalny. MemoryAI wymaga ważnego klucza API Bearer przy każdym żądaniu, więc nieautoryzowany dostęp jest blokowany na poziomie aplikacji. Obróć swój `ADMIN_API_KEY`, jeśli podejrzewasz naruszenie.

---

## Integracja z Open WebUI

MemoryAI integruje się z [Open WebUI](https://github.com/open-webui/open-webui) przez dwa komponenty Python w katalogu `openwebui/`. Nie wymagają żadnych zmian w konfiguracji modelu AI — wstrzykiwanie pamięci jest w pełni przezroczyste.

| Plik | Rola |
|------|------|
| `memoryai_filter.py` | Globalny filtr — automatycznie wstrzykuje odpowiednie wspomnienia do systemowego promptu każdej rozmowy |
| `memoryai_tools.py` | Narzędzia — pozwala modelowi jawnie wyszukiwać i zapisywać wspomnienia na żądanie |

### Filtr: `memoryai_filter.py`

Filtr uruchamia się przy każdej wiadomości — przed (`inlet`) i po (`outlet`) odpowiedzi modelu.

**Przy każdej wiadomości użytkownika (`inlet`):**
1. Wyszukuje w MemoryAI wspomnienia semantycznie trafne do wiadomości użytkownika
2. Pobiera też powiązane nazwane encje (osoby, projekty, narzędzia, systemy)
3. Buduje blok `[MEMORYAI CONTEXT]` i wstrzykuje go do systemowego promptu
4. Zapisuje wiadomość użytkownika do sesji MemoryAI do późniejszej dystylacji

**Po każdej odpowiedzi AI (`outlet`):**
1. Zapisuje odpowiedź asystenta do tej samej sesji MemoryAI
2. Wiadomości sesji gromadzą się i są dystylowane do długoterminowej pamięci po bezczynności

Oznacza to, że model zawsze ma odpowiedni kontekst z przeszłości bez konieczności mówienia przez użytkownika "zapamiętaj" lub "wyszukaj". Dystylacja automatycznie konwertuje całą rozmowę w ustrukturyzowane fakty.

### Narzędzia: `memoryai_tools.py`

Pięć jawnych narzędzi, które model może wywołać, gdy potrzebuje większej kontroli:

| Narzędzie | Opis |
|-----------|------|
| `memory_search` | Wyszukiwanie semantyczne we wszystkich przechowywanych wspomnieniach |
| `memory_save` | Zapisz nowe wspomnienie z typem i ważnością |
| `entity_get` | Pobierz wszystkie fakty dla nazwanej encji |
| `entity_save` | Utwórz lub zaktualizuj nazwaną encję |
| `memory_get_context` | Pobierz top-K najbardziej trafnych wspomnień dla bieżącego kontekstu |

### Instalacja

```bash
# Skopiuj pliki integracji do kontenera Open WebUI
docker cp openwebui/memoryai_filter.py openwebui:/app/backend/data/memoryai_filter.py
docker cp openwebui/memoryai_tools.py  openwebui:/app/backend/data/memoryai_tools.py
```

Następnie w panelu administracyjnym Open WebUI:
- **Admin → Functions → Add Filter** → wklej zawartość `memoryai_filter.py`
- **Admin → Tools → Add Tool** → wklej zawartość `memoryai_tools.py`

### Zawory filtra (konfiguracja)

Te ustawienia są konfigurowalne per użytkownik w interfejsie Open WebUI w ustawieniach filtra:

| Zawór | Domyślna | Opis |
|-------|----------|------|
| `memoryai_url` | `http://localhost:3010` | Bazowy URL API MemoryAI |
| `memoryai_token` | — | Token Bearer (skopiuj z `ADMIN_API_KEY`) |
| `max_memories` | `6` | Maksymalna liczba wspomnień wstrzykiwanych na żądanie |
| `min_score` | `0.45` | Minimalna wartość progu trafności (0.0–1.0) |
| `inject_entities` | `true` | Wstrzykuj też fakty powiązanych encji |
| `max_entities` | `3` | Maksymalna liczba bloków faktów encji do wstrzyknięcia |
| `save_to_session` | `true` | Zapisuj wiadomości do dystylacji w tle |

---

## Dokumentacja narzędzi MCP

Sześć narzędzi jest udostępnianych przez serwer MCP. Opisy narzędzi są napisane jako instrukcje behawioralne, dzięki czemu modele wywołują je automatycznie — bez wyraźnych poleceń użytkownika. Systemowy prompt modelu mówi mu, aby używał tych narzędzi na początku sesji, gdy dowiaduje się nowych faktów i na końcu sesji.

### `memory_get_context`

**Automatyczne wyzwalanie:** Początek każdej rozmowy.

Ładuje top-K wspomnień najbardziej trafnych dla bieżącego kontekstu sesji. Zwraca sformatowany blok wstrzykiwany bezpośrednio do okna kontekstu modelu. To jest główne narzędzie do pobierania kontekstu z przeszłości.

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `query` | string | tak | Krótki opis tematu lub celu bieżącej sesji |
| `limit` | integer | nie | Maksymalna liczba wspomnień do zwrócenia (domyślnie: 10, maks.: 20) |
| `session_id` | string | nie | Jeśli podany, ponownie użyje istniejącej sesji zamiast tworzyć nową |

**Przykład:**
```json
{
  "query": "bieżący projekt i preferencje użytkownika dotyczące programowania w TypeScript",
  "limit": 10
}
```

**Zwraca:** Tablicę wspomnień z `content`, `type`, `importance`, `tags` i `session_id` do użycia w kolejnych wywołaniach.

---

### `memory_save`

**Automatyczne wyzwalanie:** Po tym, jak model napotka coś wartego utrwalenia.

Zapisuje pojedyncze wspomnienie. Model wywołuje to autonomicznie, gdy wykryje fakty, decyzje, preferencje lub instrukcje, które powinny przetrwać po bieżącej sesji. Nie czeka, aż użytkownik powie "zapamiętaj to".

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `content` | string | tak | Fakt lub stwierdzenie do zapisania (maks. 10 000 znaków) |
| `type` | string | tak | Typ wspomnienia: `fact`, `decision`, `preference`, `instruction`, `entity_relation`, `summary` |
| `importance` | number | nie | Wynik ważności 0.0–1.0 (domyślnie: 0.5) |
| `tags` | array | nie | Etykiety tekstowe do filtrowania (np. `["project:memoryai", "tech:typescript"]`) |
| `session_id` | string | nie | Powiąż to wspomnienie z konkretną sesją |

**Przykład:**
```json
{
  "content": "Użytkownik preferuje TypeScript strict mode we wszystkich nowych projektach — egzekwowane na poziomie tsconfig",
  "type": "preference",
  "importance": 0.8,
  "tags": ["typescript", "coding-style", "project-setup"],
  "session_id": "sess_abc123"
}
```

---

### `memory_search`

**Automatyczne wyzwalanie:** Gdy model musi wyszukać konkretne informacje z przeszłości.

Ukierunkowane hybrydowe wyszukiwanie semantyczne we wszystkich przechowywanych wspomnieniach. Bardziej skoncentrowane i kontrolowalne niż `memory_get_context`. Przydatne, gdy model musi odpowiedzieć na konkretne pytanie o przeszłe decyzje lub preferencje.

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `query` | string | tak | Zapytanie wyszukiwania — opis w języku naturalnym tego, czego szukać |
| `limit` | integer | nie | Maksymalna liczba wyników do zwrócenia (domyślnie: 5, maks.: 20) |
| `type` | string | nie | Filtruj według typu wspomnienia: `fact`, `decision`, `preference`, `instruction`, `entity_relation`, `summary` |
| `min_importance` | number | nie | Zwróć tylko wspomnienia z ważnością >= ta wartość |

**Przykład:**
```json
{
  "query": "decyzje architektoniczne dotyczące bazy danych dla projektu cenkier",
  "limit": 5,
  "type": "decision"
}
```

**Zwraca:** Tablicę wspomnień posortowanych malejąco według hybrydowego wyniku trafności.

---

### `entity_save`

**Automatyczne wyzwalanie:** Gdy model dowiaduje się o osobie, projekcie, firmie lub systemie.

Tworzy lub aktualizuje nazwaną encję w grafie wiedzy (upsert po nazwie). Encje gromadzą fakty w sesjach — wywołanie `entity_save` dla istniejącej nazwy encji dodaje do niej nowe fakty bez zastępowania istniejących.

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `name` | string | tak | Nazwa encji — używana jako unikalny identyfikator (bez rozróżniania wielkości liter) |
| `type` | string | tak | Typ encji: `person`, `project`, `company`, `system`, `tool`, `server`, `other` |
| `facts` | array | nie | Tablica ciągów faktów do powiązania z tą encją |

**Przykład:**
```json
{
  "name": "Dell home server",
  "type": "server",
  "facts": [
    "Tailscale IP: 100.99.158.2",
    "Uruchamia Docker, Ollama, n8n i MemoryAI",
    "Główny cel wdrożenia dla wszystkich projektów samodzielnie hostowanych",
    "24 GB RAM, AMD Ryzen 5 5600G"
  ]
}
```

Typy encji:

| Typ | Używany dla |
|-----|------------|
| `person` | Członkowie zespołu, klienci, kontakty |
| `project` | Projekty oprogramowania, produkty |
| `company` | Organizacje, klienci |
| `system` | Serwery, infrastruktura, usługi |
| `tool` | Narzędzia programistyczne, biblioteki, frameworki |
| `server` | Konkretne instancje serwerów |
| `other` | Wszystko, co nie pasuje powyżej |

---

### `entity_get`

**Automatyczne wyzwalanie:** Gdy model musi przypomnieć sobie informacje o znanych encjach.

Pobiera pełny rekord encji, w tym wszystkie przechowywane fakty. Szybsze i bardziej precyzyjne niż wyszukiwanie semantyczne, gdy znasz nazwę encji.

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `name` | string | tak | Nazwa encji do wyszukania (bez rozróżniania wielkości liter) |

**Przykład:**
```json
{
  "name": "Dell home server"
}
```

**Zwraca:** Obiekt encji z `name`, `type`, tablicą `facts`, `createdAt`, `updatedAt`.

---

### `session_end`

**Automatyczne wyzwalanie:** Gdy użytkownik sygnalizuje koniec pracy, żegna się lub zamyka rozmowę.

Zamyka bieżącą sesję i kolejkuje ją do dystylacji w tle. Wywoływane też automatycznie przez timer bezczynności serwera po `DISTILL_INACTIVITY_MINUTES` bez nowych wiadomości.

**Parametry:**

| Parametr | Typ | Wymagany | Opis |
|----------|-----|----------|------|
| `session_id` | string | tak | ID sesji do zamknięcia (uzyskane z `memory_get_context`) |
| `summary` | string | nie | Opcjonalne krótkie podsumowanie tego, co zostało zrobione w tej sesji |

**Przykład:**
```json
{
  "session_id": "sess_abc123",
  "summary": "Zaprojektowano architekturę workera dystylacji, zdecydowano na BullMQ zamiast natywnej kolejki pg"
}
```

**Co dzieje się po tym wywołaniu:**
1. Status sesji ustawiony na `closed`
2. Zadanie BullMQ w kolejce: `distill-{sessionId}`
3. Worker pobiera w ciągu 1 minuty
4. LLM czyta wszystkie `session_messages` i wyodrębnia ustrukturyzowane fakty
5. Wyodrębnione fakty zapisane jako `memories` i `entities`
6. Status sesji ustawiony na `distilled`

---

## Dokumentacja REST API

Wszystkie punkty końcowe wymagają: `Authorization: Bearer YOUR_API_KEY`

Bazowy URL: `http://localhost:3001` (lub twój zdalny URL)

### Wspomnienia

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `POST` | `/v1/memories/search` | Hybrydowe wyszukiwanie semantyczne + pełnotekstowe + ważność |
| `GET` | `/v1/memories` | Lista wszystkich wspomnień (z paginacją, filtrowalne po typie/tagach) |
| `POST` | `/v1/memories` | Utwórz pojedyncze wspomnienie |
| `POST` | `/v1/memories/batch` | Masowe tworzenie do 50 wspomnień w jednym żądaniu |
| `GET` | `/v1/memories/:id` | Pobierz wspomnienie po ID |
| `PATCH` | `/v1/memories/:id` | Zaktualizuj treść, typ, ważność lub tagi wspomnienia |
| `DELETE` | `/v1/memories/:id` | Trwale usuń wspomnienie |

**Przykład wyszukiwania:**
```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "decyzje dotyczące bazy danych PostgreSQL",
    "limit": 5,
    "type": "decision",
    "min_importance": 0.6
  }'
```

**Przykład tworzenia:**
```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Zdecydowano użyć PostgreSQL z pgvector zamiast dedykowanej bazy wektorowej — pgvector jest wystarczający dla < 1M wektorów i unika złożoności operacyjnej",
    "type": "decision",
    "importance": 0.9,
    "tags": ["project:memoryai", "tech:postgresql", "tech:pgvector"]
  }'
```

**Przykład masowego tworzenia:**
```bash
curl -X POST http://localhost:3001/v1/memories/batch \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      {
        "content": "User uses pnpm as the package manager for all Node.js projects",
        "type": "preference",
        "importance": 0.6,
        "tags": ["nodejs", "tooling"]
      },
      {
        "content": "Node.js 20 LTS is the standard version on all servers",
        "type": "fact",
        "importance": 0.7,
        "tags": ["nodejs", "infrastructure"]
      },
      {
        "content": "Always write commit messages in English, even in Polish-language projects",
        "type": "instruction",
        "importance": 0.9,
        "tags": ["git", "conventions"]
      }
    ]
  }'
```

**Lista z paginacją:**
```bash
curl "http://localhost:3001/v1/memories?page=1&limit=20&type=decision" \
  -H "Authorization: Bearer YOUR_KEY"
```

---

### Sesje

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `GET` | `/v1/sessions` | Lista sesji (z paginacją, filtrowalne po statusie) |
| `POST` | `/v1/sessions` | Utwórz nową sesję |
| `GET` | `/v1/sessions/:id` | Pobierz szczegóły i status sesji |
| `GET` | `/v1/sessions/:id/messages` | Pobierz pełną historię wiadomości sesji |
| `POST` | `/v1/sessions/:id/messages` | Dodaj wiadomość do sesji |
| `POST` | `/v1/sessions/:id/close` | Zamknij sesję i wyzwól dystylację |

Statusy sesji: `open` → `closed` → `distilling` → `distilled`

**Utwórz sesję:**
```bash
curl -X POST http://localhost:3001/v1/sessions \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"context": "Working on MemoryAI dashboard feature — React + Vite"}'
```

**Dodaj wiadomość do sesji:**
```bash
curl -X POST http://localhost:3001/v1/sessions/SESSION_ID/messages \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "Let us use React Query for data fetching"}'
```

**Zamknij i wyzwól dystylację:**
```bash
curl -X POST http://localhost:3001/v1/sessions/SESSION_ID/close \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"summary": "Decided on React + Vite + React Query for dashboard"}'
```

---

### Encje

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `POST` | `/v1/entities/search` | Wyszukiwanie semantyczne wśród encji |
| `GET` | `/v1/entities` | Lista wszystkich encji |
| `POST` | `/v1/entities` | Utwórz lub zaktualizuj encję (upsert po nazwie) |
| `GET` | `/v1/entities/by-name/:name` | Pobierz encję po nazwie (zakodowanej w URL) |
| `POST` | `/v1/entities/:id/facts` | Dodaj jeden lub więcej faktów do istniejącej encji |
| `DELETE` | `/v1/entities/:id` | Usuń encję i wszystkie jej fakty |

**Utwórz encję:**
```bash
curl -X POST http://localhost:3001/v1/entities \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Dell home server",
    "type": "server",
    "facts": [
      {"content": "Tailscale IP: 100.99.158.2"},
      {"content": "Runs Docker, Ollama, n8n, MemoryAI, Postgres"},
      {"content": "Primary deployment target for self-hosted projects"},
      {"content": "24 GB RAM, AMD Ryzen 5 5600G, Ubuntu 22.04"}
    ]
  }'
```

**Pobierz encję po nazwie:**
```bash
curl "http://localhost:3001/v1/entities/by-name/Dell%20home%20server" \
  -H "Authorization: Bearer YOUR_KEY"
```

**Dodaj fakt do istniejącej encji:**
```bash
curl -X POST http://localhost:3001/v1/entities/ENTITY_ID/facts \
  -H "Authorization: Bearer YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"content": "Upgraded to 48 GB RAM in June 2026"}'
```

---

### System

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `GET` | `/health` | Sprawdzenie stanu — zwraca status, wersję, timestamp |
| `GET` | `/mcp/config` | Pobierz gotowe do wklejenia fragmenty konfiguracji MCP dla wszystkich IDE |

---

## Konfiguracja

Cała konfiguracja odbywa się przez zmienne środowiskowe. Skopiuj `.env.example` do `.env` i wypełnij wartości, lub uruchom `bash scripts/setup.sh`, aby wygenerować wszystko automatycznie.

### Baza danych

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `POSTGRES_HOST` | `localhost` | Nazwa hosta PostgreSQL |
| `POSTGRES_PORT` | `5432` | Port PostgreSQL |
| `POSTGRES_DB` | `memoryai` | Nazwa bazy danych |
| `POSTGRES_USER` | `memoryai` | Użytkownik bazy danych |
| `POSTGRES_PASSWORD` | — | **Wymagane.** Hasło PostgreSQL |
| `DATABASE_URL` | — | Pełny ciąg połączenia (nadpisuje poszczególne zmienne) |

### Redis

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `REDIS_HOST` | `localhost` | Nazwa hosta Redis |
| `REDIS_PORT` | `6379` | Port Redis |
| `REDIS_PASSWORD` | — | **Wymagane.** Hasło Redis |
| `REDIS_URL` | — | Pełny ciąg połączenia (nadpisuje poszczególne zmienne) |

### Serwer API

| Zmienna | Domyślna | Opis |
|---------|----------|------|
| `NODE_ENV` | `production` | Środowisko Node |
| `API_PORT` | `3001` | Port nasłuchiwania |
| `API_HOST` | `0.0.0.0` | Adres bind |
| `JWT_SECRET` | — | **Wymagane.** Sekret podpisywania JWT, minimum 32 znaki |
| `ADMIN_API_KEY` | — | **Wymagane.** Początkowy klucz API administratora |
| `CORS_ORIGINS` | `*` | Dozwolone źródła CORS oddzielone przecinkami |
| `MCP_SERVER_URL` | `http://localhost:3001/mcp` | Publiczny URL używany w generowanych konfiguracjach IDE |

### Dostawca embeddingów

Wybierz jednego z trzech dostawców do konwersji tekstu na wektory:

```env
# Opcja 1: Ollama (domyślna — lokalna, prywatna, bez kosztów API)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b  # 1024 wymiary, #1 MTEB multilingual, 100% recall PL/EN
EMBED_DIMENSIONS=1024

# Alternatywy:
# OLLAMA_EMBED_MODEL=mxbai-embed-large    # 1024 wymiary, 86% recall — dobry backup
# OLLAMA_EMBED_MODEL=embeddinggemma:300m  # 768 wymiarów, 300MB VRAM — ultra-lekki

# Opcja 2: Google Gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_EMBED_MODEL=text-embedding-004

# Opcja 3: OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=your_key_here
OPENAI_EMBED_MODEL=text-embedding-3-small
```

**Uwaga:** `EMBED_DIMENSIONS` musi odpowiadać modelowi. Zmiana tego ustawienia po zapisaniu danych wymaga ponownego embeddingu wszystkich istniejących wspomnień (uruchom `scripts/reembed.sh`).

### Model LLM dystylacji

LLM dystylacji czyta surowe wiadomości sesji i wyodrębnia ustrukturyzowane fakty. Działa w tle po zamknięciu sesji i nigdy nie blokuje API.

```env
# Opcja 1: Lokalny Ollama (prywatny, bez kosztów API)
DISTILL_PROVIDER=ollama
DISTILL_MODEL=qwen2.5:7b               # zalecany
# DISTILL_MODEL=qwen2.5:3b            # lżejszy, nieco niższa jakość

# Opcja 2: Google Gemini Flash (szybki, niski koszt)
DISTILL_PROVIDER=gemini
DISTILL_MODEL=gemini-2.0-flash-exp
GEMINI_API_KEY=your_key_here

# Opcja 3: Anthropic Claude Haiku (najwyższa jakość ustrukturyzowanego wyjścia)
DISTILL_PROVIDER=anthropic
DISTILL_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=your_key_here
```

### Harmonogram dystylacji

```env
# Wyzwól dystylację po N minutach bezczynności sesji (domyślnie: 15)
DISTILL_INACTIVITY_MINUTES=15

# Wyzwól też po każdych N wiadomościach niezależnie od bezczynności (0 = wyłączone)
DISTILL_EVERY_N_MESSAGES=50
```

### Bezpieczeństwo i ograniczanie liczby żądań

```env
# Maksymalna liczba wyników wyszukiwania zwracanych na zapytanie
SEARCH_MAX_RESULTS=20

# Maksymalna liczba żądań na minutę na klucz API (domyślnie: 10000)
RATE_LIMIT_RPM=10000

# Klucz szyfrowania AES-256-GCM dla wspomnień typu credential
# Wygeneruj przez: openssl rand -hex 32
# KRYTYCZNE: zrób kopię zapasową — utrata go sprawia, że zaszyfrowane wspomnienia są trwale nieczytelne
ENCRYPTION_KEY=change_me_encryption_key
```

---

## Architektura

### Przegląd komponentów

```
memoryai/
├── packages/
│   ├── api/                   Node.js 20 + TypeScript + Fastify 5
│   │   └── src/
│   │       ├── config.ts      Typowana konfiguracja env z walidacją Zod przy starcie
│   │       ├── index.ts       Punkt wejścia serwera + graceful shutdown
│   │       ├── db/pool.ts     Pula połączeń PostgreSQL + helper transakcji
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   Token Bearer → wyszukiwanie użytkownika
│   │       ├── routes/
│   │       │   ├── memories.route.ts    /v1/memories — CRUD + wyszukiwanie
│   │       │   ├── sessions.route.ts    /v1/sessions — cykl życia + wiadomości
│   │       │   └── entities.route.ts    /v1/entities — upsert + wyszukiwanie
│   │       ├── services/
│   │       │   ├── memory.service.ts    Rdzeń CRUD + zapytanie wyszukiwania hybrydowego
│   │       │   ├── session.service.ts   Cykl życia sesji + bufor wiadomości
│   │       │   ├── entity.service.ts    Upsert encji + wyszukiwanie wektorowe
│   │       │   ├── embedding.service.ts Abstrakcja wielu dostawców (Ollama/Gemini/OpenAI)
│   │       │   └── auth.service.ts      Tworzenie + walidacja kluczy API
│   │       ├── mcp/
│   │       │   └── server.ts            MCP JSON-RPC 2.0 przez HTTP + SSE (6 narzędzi)
│   │       └── jobs/
│   │           ├── distillation.queue.ts   Definicja kolejki BullMQ
│   │           └── distillation.worker.ts  Ekstrakcja LLM w tle + harmonogram bezczynności
│   ├── dashboard/             React + Vite admin UI (w trakcie rozwoju)
│   ├── sdk/                   TypeScript client SDK — @memoryai/client (w trakcie rozwoju)
│   └── shared/                Wspólne typy TypeScript (Memory, Session, Entity, itp.)
├── integrations/
│   └── claude-code/
│       ├── mcp-local-ai.py    Serwer MCP stdio dla orkiestracji wielomodelowej
│       └── ask-model.py       Narzędzie CLI do bezpośrednich wywołań modeli
├── openwebui/
│   ├── memoryai_filter.py     Globalny filtr Open WebUI (auto-wstrzykiwanie wspomnień)
│   └── memoryai_tools.py      Jawne narzędzia Open WebUI
├── docker/
│   ├── docker-compose.yml     PostgreSQL 16+pgvector, Redis 7, usługa API
│   ├── Dockerfile.api         Wieloetapowy produkcyjny build Docker
│   └── postgres/
│       ├── init.sql           Pełny schemat DB, indeksy wektorowe, funkcje wyszukiwania hybrydowego
│       └── seed.sql           Dane początkowe (domyślny użytkownik admin)
├── scripts/
│   ├── setup.sh               Automatyzacja pierwszego ustawienia
│   └── create-vector-index.sh Budowanie indeksu HNSW po masowym imporcie danych
├── install.py                 Uniwersalny instalator IDE (serwowany przez /dashboard/install.py)
└── .env.example               Wszystkie zmienne konfiguracyjne udokumentowane
```

### Schemat bazy danych

```sql
-- Zarządzanie kluczami API i obsługa wielu użytkowników
users (
  id UUID PRIMARY KEY,
  api_key TEXT UNIQUE NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ
)

-- Opcjonalna przestrzeń nazw do izolacji wspomnień między projektami
projects (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- Śledzenie rozmów
sessions (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  context TEXT,
  status TEXT,              -- open | closed | distilling | distilled
  message_count INTEGER,
  last_activity_at TIMESTAMPTZ,
  distilled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ
)

-- Surowy bufor wiadomości — wejście dla dystylacji
session_messages (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions,
  role TEXT,                -- user | assistant | system
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- Trwałe długoterminowe wspomnienia
memories (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  session_id UUID REFERENCES sessions,
  content TEXT NOT NULL,
  type TEXT,                -- fact | decision | preference | instruction | entity_relation | summary
  importance FLOAT DEFAULT 0.5,
  embedding VECTOR(768),    -- kolumna pgvector (wymiar konfigurowalny)
  content_tsv TSVECTOR,     -- dla wyszukiwania pełnotekstowego
  tags TEXT[],
  pinned BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
)

-- Graf wiedzy nazwanych encji
entities (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users,
  name TEXT NOT NULL,
  type TEXT,                -- person | project | company | system | tool | server | other
  embedding VECTOR(768),
  UNIQUE(user_id, name)
)

-- Fakty encji (jedna encja → wiele faktów)
entity_facts (
  id UUID PRIMARY KEY,
  entity_id UUID REFERENCES entities,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ
)

-- Śledzenie zadań BullMQ
distillation_jobs (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES sessions,
  bullmq_job_id TEXT,
  status TEXT,              -- queued | processing | done | failed
  error TEXT,
  created_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ
)
```

**Indeksy:**
- `memories.embedding` — indeks wektorowy HNSW (ivfflat domyślnie, HNSW opcjonalnie przez `create-vector-index.sh`)
- `memories.content_tsv` — indeks GIN dla wyszukiwania pełnotekstowego
- `memories.user_id`, `memories.type`, `memories.importance` — kompozytowy indeks B-tree dla filtrowanego wyszukiwania
- `entities.embedding` — indeks HNSW/ivfflat dla semantycznego wyszukiwania encji
- `sessions.user_id, last_activity_at` — indeks dla zapytań workera bezczynności

### Stos technologiczny

| Warstwa | Technologia |
|---------|-------------|
| Serwer API | Node.js 20 + TypeScript 5 + Fastify 5 |
| Baza danych | PostgreSQL 16 + pgvector 0.7 |
| Cache i kolejka | Redis 7 + BullMQ 5 |
| Transport MCP | HTTP + SSE (JSON-RPC 2.0, protokół MCP 2024-11-05) |
| Walidacja wejścia | Zod |
| Kontener | Docker + Docker Compose v2 |
| Embeddingi | Ollama / Google Gemini / OpenAI (abstrakcja niezależna od dostawcy) |
| Dystylacja | Ollama / Gemini Flash / Anthropic Claude Haiku |
| Multi-agent | Serwer MCP Python 3 stdio + klient ConnectRPC |

---

## Struktura projektu

```
memoryai/
├── .env.example                         Wszystkie zmienne konfiguracyjne z dokumentacją
├── .gitignore
├── install.py                           Uniwersalny instalator IDE (serwowany jako /dashboard/install.py)
├── docker/
│   ├── docker-compose.yml               PostgreSQL 16+pgvector + Redis 7 + usługa API
│   ├── Dockerfile.api                   Wieloetapowy build produkcyjny (builder → runtime)
│   └── postgres/
│       ├── init.sql                     Schemat DB, indeks wektorowy, hybrydowa funkcja SQL wyszukiwania
│       └── seed.sql                     Początkowy wiersz użytkownika admin
├── integrations/
│   └── claude-code/
│       ├── mcp-local-ai.py              Serwer MCP stdio: ask_gemini, ask_model, ask_ollama, narzędzia listy
│       └── ask-model.py                 CLI: wywołaj dowolny model z terminala
├── openwebui/
│   ├── memoryai_filter.py               Globalny filtr: auto-wstrzykiwanie wspomnień do każdego czatu
│   └── memoryai_tools.py                Jawne narzędzia: wyszukiwanie, zapisywanie, operacje na encjach
├── packages/
│   ├── shared/
│   │   └── src/
│   │       └── types.ts                 Wspólne typy TypeScript: Memory, Session, Entity, itp.
│   ├── api/
│   │   ├── package.json
│   │   └── src/
│   │       ├── config.ts                Typowana konfiguracja env, walidacja przy starcie
│   │       ├── index.ts                 Konfiguracja aplikacji Fastify + graceful shutdown
│   │       ├── db/
│   │       │   └── pool.ts              Pula PostgreSQL + helper withTransaction
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   Klucz API → obiekt User + dołącz do żądania
│   │       ├── routes/
│   │       │   ├── memories.route.ts    Pełne CRUD + wyszukiwanie hybrydowe
│   │       │   ├── sessions.route.ts    Cykl życia sesji + punkty końcowe wiadomości
│   │       │   └── entities.route.ts    Upsert encji + zarządzanie faktami + wyszukiwanie
│   │       ├── services/
│   │       │   ├── memory.service.ts    Zapytanie wyszukiwania hybrydowego + CRUD
│   │       │   ├── session.service.ts   Otwórz/zamknij/timer bezczynności
│   │       │   ├── entity.service.ts    Upsert po nazwie + wyszukiwanie wektorowe
│   │       │   ├── embedding.service.ts Abstrakcja dostawcy: embed(text) → Float32Array
│   │       │   └── auth.service.ts      Generowanie kluczy nanoid + walidacja
│   │       ├── mcp/
│   │       │   └── server.ts            Handler JSON-RPC 2.0 + 6 implementacji narzędzi
│   │       └── jobs/
│   │           ├── distillation.queue.ts  Kolejka BullMQ + definicje typów zadań
│   │           └── distillation.worker.ts Worker: prompt LLM + ekstrakcja wspomnień + harmonogram
│   ├── dashboard/                       React + Vite UI (w trakcie rozwoju)
│   └── sdk/                             @memoryai/client TypeScript SDK (w trakcie rozwoju)
└── scripts/
    ├── setup.sh                         Pierwsze ustawienie: generowanie .env, Docker, konfiguracja IDE
    └── create-vector-index.sh           Budowanie indeksu HNSW dla dużych zbiorów danych
```

---

## Wymagania systemowe

### Minimalne (środowisko deweloperskie / lekkie użycie)

| Komponent | Minimum |
|-----------|---------|
| CPU | 2 rdzenie |
| RAM | 2 GB (PostgreSQL 512 MB + Redis 256 MB + API 256 MB) |
| Dysk | 5 GB |
| Node.js | 20 LTS |
| Docker | 24+ z Compose v2 |
| PostgreSQL | 16+ (przez obraz Docker `pgvector/pgvector:pg16`) |
| Redis | 7+ |
| Python | 3.8+ (dla `mcp-local-ai.py` i `ask-model.py`) |

### Zalecane (produkcja)

| Komponent | Zalecane |
|-----------|----------|
| CPU | 4+ rdzenie |
| RAM | 8 GB (rezerwa dla indeksu HNSW pgvector i dużych partii embeddingów) |
| Dysk | 50+ GB SSD (rośnie ze wspomnieniami; wektor 768-dim ≈ 3–4 KB na wspomnienie) |
| Node.js | 20 LTS |

### Modele Ollama dla lokalnych embeddingów i dystylacji

#### Modele embeddingów — wyniki testów (benchmark PL/EN retrieval, 7 zapytań)

| Model | Wymiary | VRAM | Recall PL/EN | Uwagi |
|-------|---------|------|-------------|-------|
| `nomic-embed-text` | 768 | 274 MB | 14% (1/7) | Angielski — słaby dla polskiego |
| `mxbai-embed-large` | 1024 | 670 MB | 71% (5/7) | Dobry wielojęzyczny |
| `mxbai-embed-large` + optymalizacje | 1024 | 670 MB | 86% (6/7) | + query prefix, pg_trgm, wagi |
| **`qwen3-embedding:0.6b`** | **1024** | **600 MB** | **100% (7/7)** | **Zalecany — #1 MTEB multilingual** |
| `qwen3-embedding:4b` | 2560 | 2.5 GB | 86% (6/7) | Paradoks: większy ≠ lepszy tutaj |
| `embeddinggemma:300m` | 768 | 300 MB | 71% (5/7) | Lekki, Google, dobry dla EN |

**Rekomendacja:** `qwen3-embedding:0.6b` z `EMBED_DIMENSIONS=1024`. Zajmuje tylko 600 MB VRAM, najlepszy recall dla treści mieszanych PL/EN, dostępny przez `ollama pull qwen3-embedding:0.6b`.

#### Modele dystylacji

| Model | Typ | RAM / VRAM | Uwagi |
|-------|-----|-----------|-------|
| `qwen2.5:7b` | Dystylacja | 4.7 GB | Zalecany — silna ekstrakcja ustrukturyzowanych faktów |
| `qwen2.5:3b` | Dystylacja | 2.0 GB | Lżejsza alternatywa, nieco niższa jakość ekstrakcji |
| `llama3.2:3b` | Dystylacja | 2.0 GB | Alternatywa skoncentrowana na angielskim |

Ollama ładuje modele na żądanie i rozładowuje je po upływie czasu bezczynności. Jednoczesne uruchamianie embeddingu i dystylacji z zalecanymi modelami wymaga około 5–6 GB RAM lub VRAM.

### Szacunkowy wzrost przechowywania

| Metryka | Rozmiar |
|---------|---------|
| 1 wspomnienie (wektor 768-dim + tekst) | ~3–4 KB w PostgreSQL |
| 1 000 wspomnień | ~4 MB |
| 10 000 wspomnień | ~40 MB |
| 100 000 wspomnień | ~400 MB |
| 1 sesja (50 wiadomości) | ~50–200 KB |

Po 1 roku aktywnego codziennego użytkowania (10 sesji/dzień, 5 wspomnień wyodrębnionych na sesję): około 18 000 wspomnień = ~72 MB. Zupełnie zarządzalne na każdym nowoczesnym systemie.

### Zużycie pamięci RAM w trakcie działania

| Usługa | RAM bezczynna | RAM szczyt |
|--------|---------------|------------|
| PostgreSQL + pgvector | ~100 MB | ~512 MB |
| Redis | ~10 MB | ~256 MB |
| MemoryAI API | ~80 MB | ~200 MB |
| Ollama (załadowany nomic-embed-text) | ~300 MB | ~500 MB |
| **Łącznie** | **~490 MB** | **~1.5 GB** |

### Zużycie tokenów (Claude)

MemoryAI deleguje obliczenia do Ollamy lokalnie — embeddingi i dystylacja **nie zużywają tokenów Claude**. Jedyny overhead to kontekst wstrzykiwany do okna rozmowy:

| Komponent | Tokeny Claude | Częstotliwość | Uwagi |
|-----------|--------------|---------------|-------|
| Opisy 6 narzędzi MCP | ~900 | Raz na sesję | Stały koszt, ładowany przy starcie |
| Wywołanie `memory_get_context` | ~23 | Per query | Sam JSON call |
| Wstrzyknięty kontekst (10 wspomnień) | ~215 | Per query | Faktyczna pamięć |
| Surowa odpowiedź API (JSON) | ~1600 | Per query | Widoczne przez model |
| `memory_save` call + response | ~58 | Per zapis | Minimalne |
| **Łącznie per zapytanie** | **~2800** | Per query | |

Dystylacja i embeddingi używają **0 tokenów Claude** (Ollama lokalnie):

| Operacja | Tokeny | Model |
|----------|--------|-------|
| Embedding wspomnienia | ~50 | Ollama — qwen3-embedding:0.6b |
| Dystylacja sesji (6 wiad.) | ~300 | Ollama — qwen2.5:7b |

**Overhead względny** (2800 tokenów) zależy od rozmiaru kontekstu rozmowy:

| Kontekst rozmowy | Overhead pamięci |
|-----------------|-----------------|
| 10K tokenów | +28% |
| 50K tokenów | +5.6% |
| 100K tokenów | +2.8% |
| 200K tokenów | +1.4% |

W typowej sesji Claude Code (50K+ kontekstu) overhead MemoryAI wynosi **mniej niż 6%** tokenów Claude.

### Opóźnienia sieciowe

| Operacja | Typowe opóźnienie |
|----------|-------------------|
| Embedding (lokalny Ollama, GPU) | 10–50 ms |
| Embedding (Gemini API) | 100–300 ms |
| Wyszukiwanie hybrydowe (PostgreSQL) | 5–20 ms |
| Dystylacja (Gemini Flash) | 500–2 000 ms na sesję |
| Dystylacja (lokalny qwen2.5:7b, CPU) | 5–30 s na sesję |
| Dystylacja (lokalny qwen2.5:7b, GPU) | 1–5 s na sesję |
| Wywołanie `ask_gemini` (przez MCP local-ai) | 200–2 000 ms zależnie od modelu |
| Wywołanie `ask_ollama` (qwen3.5:4b, GPU) | 500–3 000 ms |

---

## Szczegóły dystylacji

Dystylacja to proces konwertowania surowej historii wiadomości sesji w ustrukturyzowane, trwałe wspomnienia długoterminowe. Działa całkowicie w tle przez BullMQ i Redis i nigdy nie blokuje API ani użytkownika.

### Wyzwalacze

Dystylacja jest wyzwalana przez warunek, który odpali pierwszy:

1. **Timer bezczynności** — `DISTILL_INACTIVITY_MINUTES` (domyślnie: 15) minut bez nowych wiadomości w sesji. Worker dystylacji sprawdza zaległe sesje co 1 minutę.
2. **Liczba wiadomości** — co `DISTILL_EVERY_N_MESSAGES` wiadomości, jeśli ta zmienna jest ustawiona i > 0.
3. **Ręczne zamknięcie** — narzędzie MCP `session_end` lub punkt końcowy REST `POST /v1/sessions/:id/close`.

### Proces dystylacji krok po kroku

```
Sesja oznaczona jako 'closed'
        │
        ▼
Zadanie BullMQ w kolejce: "distill-{sessionId}"
(ID zadania używa myślników, nie dwukropków — dwukropki są separatorami kluczy Redis)
        │
        ▼
Worker odpytuje kolejkę Redis co ~1 minutę
        │
        ▼
Worker pobiera zadanie → status sesji ustawiony na 'distilling'
        │
        ▼
Pobierz wszystkie session_messages WHERE session_id = ? ORDER BY created_at
        │
        ▼
Zbuduj prompt dystylacji:
  System: "Jesteś asystentem ekstrakcji wspomnień..."
  User: "Wyodrębnij fakty, decyzje, preferencje, instrukcje z:\n{messages}"
        │
        ▼
Wywołaj LLM dystylacji (Ollama / Gemini / Anthropic)
        │
        ▼
Parsuj ustrukturyzowaną odpowiedź JSON:
  [
    {"type": "decision", "content": "...", "importance": 0.9, "tags": [...]},
    {"type": "preference", "content": "...", "importance": 0.7, ...},
    {"type": "entity", "name": "...", "entity_type": "...", "facts": [...]}
  ]
        │
        ▼
Zapisz wspomnienia → INSERT INTO memories (z embeddingami)
Zapisz encje → UPSERT entities + entity_facts
        │
        ▼
Status sesji ustawiony na 'distilled'
Surowe wiadomości opcjonalnie przycinane (konfigurowalne)
```

### Porównanie dostawców dystylacji

| Dostawca | Szybkość | Prywatność | Koszt | Najlepszy dla |
|----------|----------|------------|-------|---------------|
| Ollama (qwen2.5:7b, GPU) | 1–5 s/sesja | 100% lokalnie | Darmowy | Konfiguracje priorytetyzujące prywatność |
| Ollama (qwen2.5:7b, CPU) | 5–30 s/sesja | 100% lokalnie | Darmowy | Domowe serwery niskobudżetowe |
| Gemini Flash | 0.5–2 s/sesja | Chmura | Niski | Najlepszy stosunek ceny do jakości |
| Anthropic Claude Haiku | 1–3 s/sesja | Chmura | Niski-średni | Najbardziej ustrukturyzowane wyjście |

### Tygodniowe zadania konserwacyjne

Dwa tygodniowe zadania uruchamiają się automatycznie, aby utrzymać wysoką jakość wspomnień:

**Konsolidacja temporalna** — znajduje grupy semantycznie podobnych wspomnień (podobieństwo cosinusowe > 0.92) tworzonych w tym samym oknie czasowym i scala je w jedno, bogatsze wspomnienie. Zapobiega dryfowi semantycznemu ze względu na powtarzające się dystylacje podobnych sesji.

**Deduplikacja** — znajduje wspomnienia z bardzo wysokim podobieństwem (> 0.98) i usuwa starsze duplikaty, zachowując wersję o najwyższej ważności. Zapobiega rozrostowi z redundantnych faktów.

### Dostosowywanie promptu dystylacji

Prompt dystylacji znajduje się w `packages/api/src/jobs/distillation.worker.ts` i może być swobodnie dostosowywany. Użyteczne dostosowania:
- Dodaj instrukcje językowe ("Zawsze wyodrębniaj po angielsku niezależnie od języka rozmowy")
- Dodaj typy faktów specyficzne dla domeny do twojego przypadku użycia
- Dostosuj wytyczne punktacji ważności
- Dodaj listę tematów, których należy specjalnie szukać i zawsze wyodrębniać

### Wskazówki dotyczące jakości

- **Utrzymuj skupione sesje** — jakość dystylacji pogarsza się przy bardzo długich rozmowach przeskakujących między tematami. Jeśli rozmowa znacząco zmienia temat, zakończ sesję i zacznij nową.
- **Gemini Flash** ma najlepszy stosunek ceny do jakości w większości przypadków.
- **Anthropic Claude Haiku** produkuje najbardziej konsekwentnie ustrukturyzowane i poprawnie otagowane wyjście.
- **Lokalny qwen2.5:7b** jest zaskakująco dobry dla polskich treści i działa całkowicie offline.
- Sesje z mniej niż 5 wiadomościami domyślnie nie są dystylowane (konfigurowalny próg), aby uniknąć szumów.

---

## Bezpieczeństwo

### Uwierzytelnianie

- Wszystkie punkty końcowe REST i MCP wymagają `Authorization: Bearer <key>` — nie ma nieuwierzytelnionej powierzchni
- Klucze API to kryptograficznie losowe ciągi 48-znakowe generowane przez `nanoid`
- Początkowy klucz administratora jest ustawiany przy starcie przez `ADMIN_API_KEY` — jest haszowany przed przechowaniem
- Dodatkowe klucze API mogą być tworzone przez REST API przez uwierzytelnionego administratora
- Obróć klucz, usuwając go przez API i tworząc nowy — stary klucz jest natychmiast unieważniany

### Izolacja danych

- Każde zapytanie bazodanowe jest ograniczone przez `user_id` — nie ma mechanizmu, przez który jeden użytkownik mógłby uzyskać dostęp do wspomnień, sesji lub encji innego użytkownika
- `session_end` weryfikuje własność sesji przed zamknięciem
- `addMessage` weryfikuje własność sesji wewnątrz transakcji bazodanowej
- Nie ma punktu końcowego admina do odczytu wspomnień innego użytkownika w czystym tekście

### Zapobieganie SQL injection

- Wszystkie zapytania używają **sparametryzowanych przygotowanych instrukcji** wyłącznie — brak interpolacji ciągów nigdzie w SQL
- Zod waliduje wszystkie wejścia zanim dotrą do warstwy usług — nieprawidłowe wejścia są odrzucane na poziomie route
- Wartości enum (`type`, `status`, itp.) są walidowane przez Zod, nigdy interpolowane do ciągów zapytań

### Walidacja wejścia

- Wszystkie punkty końcowe REST mają schematy Zod na poziomie route — brakujące lub nieprawidłowo typowane pola zwracają 400 ze szczegółami
- Argumenty narzędzi MCP są walidowane jawnymi sprawdzeniami typów przed jakimkolwiek przetwarzaniem
- Egzekwowane limity długości ciągów: `content` maks. 10 000 znaków, `name` maks. 255 znaków
- Pola tablicowe mają maksymalne limity długości, aby zapobiec DoS przez nadmiarowe payloady

### Ograniczanie liczby żądań

- Domyślnie: 10 000 żądań na minutę na klucz API (konfigurowalne przez `RATE_LIMIT_RPM`)
- Zaimplementowane przez `@fastify/rate-limit` wspierane przez Redis — limity są współdzielone między instancjami API
- Zwraca `HTTP 429 Too Many Requests` z nagłówkiem `Retry-After` po przekroczeniu

### Nagłówki bezpieczeństwa

- `@fastify/helmet` dodaje standardowe nagłówki bezpieczeństwa HTTP do każdej odpowiedzi:
  - `Content-Security-Policy`
  - `Strict-Transport-Security` (HSTS)
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
- CORS jest ograniczony do jawnie dozwolonych źródeł przez zmienną env `CORS_ORIGINS` (bez wildcard w produkcji)

### Szyfrowanie w spoczynku

- Wspomnienia otagowane typem `credentials` (lub gdy `ENCRYPTION_KEY` jest skonfigurowany) są szyfrowane AES-256-GCM przed przechowaniem
- Klucz szyfrowania nigdy nie jest przechowywany w bazie danych — musi być dostarczony w czasie działania przez `ENCRYPTION_KEY`
- **Krytyczne:** Zrób kopię zapasową swojego `ENCRYPTION_KEY`. Jego utrata sprawia, że zaszyfrowane wspomnienia są trwale nieczytelne.

### Czego nie ma (v0.1)

- Interfejs rejestracji użytkowników — admin tworzy użytkowników przez REST API
- Logowanie OAuth2 / SSO
- Logi audytu / historia dostępu
- Automatyczna rotacja kluczy

---

## Mapa drogowa

- [ ] **Reranker cross-encoder** — `reranker.service.ts` już zaimplementowany z graceful fallback; czeka na `POST /api/rerank` w Ollama (endpoint jeszcze niedostępny w v0.30.5)
- [ ] **Panel React** (`packages/dashboard`) — przeglądanie wspomnień, wyszukiwanie, edycja, wyświetlanie statusu zadań dystylacji, analityka, wizualizacja grafu wspomnień
- [ ] **TypeScript SDK** (`packages/sdk`, `@memoryai/client`) — typowany klient do łatwej integracji w dowolnej aplikacji Node.js
- [ ] **Python SDK** (`pip install memoryai`) — dla środowisk Python, Jupyter notebooks, LangChain, LlamaIndex
- [ ] **Middleware proxy** — przezroczysty proxy kompatybilny z OpenAI API, który auto-wstrzykuje kontekst pamięci i auto-zapisuje odpowiedzi modelu, bez żadnych zmian po stronie modelu
- [ ] **Zanikanie wspomnień** — automatyczne zmniejszanie wyników ważności starych, nieużywanych wspomnień; opcjonalne archiwizowanie lub usuwanie
- [ ] **Interfejs administracyjny wielu użytkowników** — zarządzanie użytkownikami, limity wspomnień per użytkownik, statystyki użytkowania
- [ ] **Eksport / import** — kopia zapasowa i przywracanie wszystkich wspomnień jako przenośny JSON; import z ChatGPT Memory, Mem0, itp.
- [ ] **Konsolidacja wspomnień** — okresowa automatyczna deduplikacja i scalanie podobnych wspomnień (tygodniowe zadanie już w kolejce, UI i dostrajanie wkrótce)
- [ ] **Przestrzenie nazw projektów** — izoluj wspomnienia per projekt, aby różne agenty AI pracujące na różnych bazach kodu nie zanieczyszczały nawzajem swoich kontekstów
- [ ] **Wzbogacenie wyszukiwaniem internetowym** — opcjonalnie wzbogacaj wspomnienia wynikami wyszukiwania internetowego w czasie dystylacji dla lepszego kontekstu
- [ ] **Interfejs przypiętych wspomnień** — łatwe przypinanie / odpinanie wspomnień z panelu

---

## Licencja

MIT
