# MemoryAI

**🌐 Language / Język:** [English](README.md) · [Polski](README.pl.md)

---

**Trwała pamięć dla modeli językowych.** Daje modelom AI (Claude, Gemini, GPT, Ollama) dostęp do faktów, decyzji i kontekstu z poprzednich sesji — automatycznie, bez żadnego wysiłku ze strony użytkownika.

> "Dlaczego twój asystent AI zapomina, co ustaliliście wczoraj?" — MemoryAI rozwiązuje ten problem, działając jako zewnętrzny, odpytywalny mózg dla każdego modelu językowego.

Self-hosted · PostgreSQL + pgvector · BullMQ · MCP + REST API · Wieloproviderowe embeddingi

---

## Spis treści

- [Jak to działa](#jak-to-działa)
- [Szybki start](#szybki-start)
- [Integracja z IDE](#integracja-z-ide)
  - [Uniwersalny instalator](#uniwersalny-instalator)
  - [Konfiguracja ręczna — poszczególne IDE](#konfiguracja-ręczna--poszczególne-ide)
- [Zdalny dostęp przez Tailscale](#zdalny-dostęp-przez-tailscale)
- [Konfiguracja](#konfiguracja)
- [Narzędzia MCP — dokumentacja](#narzędzia-mcp--dokumentacja)
- [Integracja z Open WebUI](#integracja-z-open-webui)
- [Orkiestracja multi-agent](#orkiestracja-multi-agent)
- [REST API — dokumentacja](#rest-api--dokumentacja)
- [Typy wspomnień i skala ważności](#typy-wspomnień-i-skala-ważności)
- [Architektura](#architektura)
- [Struktura projektu](#struktura-projektu)
- [Wymagania systemowe](#wymagania-systemowe)
- [Szacowane zasoby](#szacowane-zasoby)
- [Szczegóły dystylacji](#szczegóły-dystylacji)
- [Bezpieczeństwo](#bezpieczeństwo)
- [Mapa drogowa](#mapa-drogowa)
- [Licencja](#licencja)

---

## Jak to działa

Modele językowe są **bezstanowe** — każda sesja zaczyna się od zera. MemoryAI dodaje trwałą warstwę pamięci między IDE/agentem a modelem:

```
┌─────────────────────────────────────────────────────────┐
│           ANTIGRAVITY / CLAUDE CODE / DOWOLNY LLM        │
│  Model widzi narzędzia MCP → wywołuje je automatycznie   │
└────────────────────────┬────────────────────────────────┘
                         │  MCP (HTTP/SSE) lub REST API
┌────────────────────────▼────────────────────────────────┐
│               Serwer MemoryAI (Node.js + Fastify)        │
│                                                          │
│  ① start sesji      → memory_get_context()              │
│     zwraca istotne wspomnienia, wstrzykiwane do kontekstu│
│                                                          │
│  ② w trakcie sesji  → memory_save() / entity_save()     │
│     model zapisuje fakty, decyzje, preferencje           │
│                                                          │
│  ③ koniec sesji     → session_end()                     │
│     uruchamia dystylację pełnej rozmowy w tle            │
└──────┬──────────────────┬──────────────────────────────┘
       │                  │
┌──────▼──────┐   ┌───────▼──────────┐
│ PostgreSQL  │   │   Redis          │
│ + pgvector  │   │   kolejka BullMQ │
│             │   │   cache sesji    │
│ wspomnienia │   └──────────────────┘
│ sesje       │            │
│ encje       │   ┌────────▼─────────┐
│ użytkownicy │   │ LLM dystylacyjny │
└─────────────┘   │ (Ollama/Gemini/  │
                  │  Anthropic)      │
                  └──────────────────┘
```

### Automatyczny przepływ pamięci — zero wysiłku użytkownika

| Etap | Co się dzieje | Kto inicjuje |
|------|--------------|--------------|
| Początek rozmowy | `memory_get_context` → top-K najtrafniejszych wspomnień wstrzykiwanych do kontekstu | Model (automatycznie, na podstawie opisu narzędzia MCP) |
| W trakcie rozmowy | `memory_save`, `entity_save` — model zapisuje ważne fakty | Model (własna ocena) |
| Koniec sesji lub 15 min nieaktywności | Worker w tle dystyluje rozmowę → wyciąga ustrukturyzowane fakty | Serwer (timer, bez akcji użytkownika) |
| Następna rozmowa | Model ma pełny kontekst z poprzedniej sesji | — |

### Wyszukiwanie hybrydowe

Wspomnienia są pobierane na podstawie ważonej kombinacji trzech sygnałów, wykonanej w jednym zapytaniu PostgreSQL:

| Sygnał | Waga | Metoda |
|--------|------|--------|
| Podobieństwo semantyczne | 70% | Odległość kosinusowa przez pgvector |
| Dopasowanie pełnotekstowe | 20% | BM25 / tsvector |
| Ocena ważności | 10% | Zdefiniowana przez użytkownika lub LLM (0.0–1.0) |

---

## Szybki start

### 1. Sklonuj i uruchom setup

```bash
git clone https://github.com/cenkierpiotr/memoryai
cd memoryai
bash scripts/setup.sh
```

Skrypt `setup.sh` wykonuje automatycznie:

- Generuje `.env` z kryptograficznie losowymi sekretami
- Uruchamia PostgreSQL 16 + pgvector i Redis 7 przez Docker Compose
- Wykrywa zainstalowane modele Ollama i konfiguruje najlepszy dostępny
- Konfiguruje MCP w Antigravity (`~/.gemini/antigravity/mcp_config.json`)
- Konfiguruje MCP w Claude Code (`~/.claude/settings.json`)

### 2. Uruchom serwer

```bash
# Docker Compose (zalecane — zawiera PostgreSQL + Redis)
docker compose -f docker/docker-compose.yml up -d

# Lokalne deweloperskie (PostgreSQL i Redis muszą już działać)
npm install
npm run dev -w packages/api
```

### 3. Sprawdź działanie

```bash
curl http://localhost:3001/health
# {"status":"ok","version":"0.1.0","timestamp":"..."}
```

### 4. Przeładuj IDE

Po setupie uruchom ponownie IDE lub przeładuj serwer MCP. Modele AI automatycznie uzyskają dostęp do wszystkich sześciu narzędzi pamięci.

---

## Integracja z IDE

### Uniwersalny instalator

Jeden skrypt Python automatycznie wykrywa wszystkie zainstalowane IDE i zapisuje do każdego z nich poprawną konfigurację MCP. Działa na Linux, macOS i Windows bez żadnych dodatkowych zależności poza Python 3.

**Linux / macOS:**
```bash
curl -sL https://your-server/dashboard/install.py | python3
```

**Windows (PowerShell):**
```powershell
python3 -c "import urllib.request; exec(urllib.request.urlopen('https://your-server/dashboard/install.py').read())"
```

Zamień `your-server` na adres serwera MemoryAI (np. `localhost:3001` albo URL Tailscale Funnel).

**Opcje instalatora:**

| Flaga | Opis |
|-------|------|
| `--force` | Nadpisz istniejące wpisy MCP bez pytania |
| `--check` | Tryb podglądu — wykryj IDE i sprawdź konfiguracje, nic nie zapisuj |
| `--list` | Tylko wykryj zainstalowane IDE, wydrukuj ścieżki i zakończ |

**Przykład:**
```bash
curl -sL https://your-server/dashboard/install.py | python3 -- --check
```

Instalator zapisuje URL serwera MCP (wraz z kluczem API w nagłówku `Authorization`) do pliku konfiguracyjnego każdego wykrytego IDE. Ścieżki są dostosowane do platformy:

| IDE | Linux | Windows | macOS |
|-----|-------|---------|-------|
| Cursor | `~/.cursor/mcp.json` | `%USERPROFILE%\.cursor\mcp.json` | `~/.cursor/mcp.json` |
| VS Code | `~/.config/Code/User/mcp.json` | `%APPDATA%\Code\User\mcp.json` | `~/Library/Application Support/Code/User/mcp.json` |
| Windsurf | `~/.windsurf/mcp.json` | `%USERPROFILE%\.windsurf\mcp.json` | `~/.windsurf/mcp.json` |
| Continue.dev | `~/.continue/config.json` | `%USERPROFILE%\.continue\config.json` | `~/.continue/config.json` |
| Claude Desktop | `~/.config/Claude/claude_desktop_config.json` | `%APPDATA%\Claude\claude_desktop_config.json` | `~/Library/Application Support/Claude/claude_desktop_config.json` |

---

### Konfiguracja ręczna — poszczególne IDE

Wszystkie konfiguracje ręczne wymagają klucza API. Znajdziesz go w `.env` (`ADMIN_API_KEY`) lub możesz utworzyć nowy przez REST API.

#### Cursor

`~/.cursor/mcp.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
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
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
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
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
      }
    }
  }
}
```

#### Continue.dev

`~/.continue/config.json` — dodaj do tablicy `mcpServers`:
```json
{
  "mcpServers": [
    {
      "name": "memoryai",
      "transport": {
        "type": "http",
        "url": "http://localhost:3001/mcp",
        "headers": {
          "Authorization": "Bearer TWÓJ_KLUCZ_API"
        }
      }
    }
  ]
}
```

#### Claude Desktop

Ścieżka zależna od platformy:
- **Linux:** `~/.config/Claude/claude_desktop_config.json`
- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "memoryai": {
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
      }
    }
  }
}
```

#### Antigravity (Google)

`~/.gemini/antigravity/mcp_config.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "serverUrl": "http://localhost:3001/mcp/sse",
      "headers": {
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
      }
    }
  }
}
```

#### Claude Code (CLI)

`~/.claude/settings.json`:
```json
{
  "mcpServers": {
    "memoryai": {
      "type": "http",
      "url": "http://localhost:3001/mcp",
      "headers": {
        "Authorization": "Bearer TWÓJ_KLUCZ_API"
      }
    }
  }
}
```

#### Gotowe snippety przez API

```bash
curl -H "Authorization: Bearer TWÓJ_KLUCZ_API" \
  http://localhost:3001/mcp/config
```

Zwraca obiekt JSON z gotowymi fragmentami konfiguracji dla wszystkich obsługiwanych IDE.

---

## Zdalny dostęp przez Tailscale

MemoryAI można udostępnić publicznie przez HTTPS za pomocą **Tailscale Funnel** — wtedy serwer jest dostępny z każdej maszyny (dom, laptop w pracy, urządzenie mobilne) bez konieczności konfigurowania klienta VPN.

### Konfiguracja

```bash
# Udostępnij port 3001 przez Tailscale Serve (tylko twoja sieć Tailnet)
tailscale serve --bg 3001

# Udostępnij publicznie przez Tailscale Funnel (publiczne HTTPS)
tailscale funnel --bg 3001
```

Po wykonaniu tych poleceń serwer MemoryAI jest dostępny pod adresem:

```
https://twoje-urzadzenie.tailfbeb53.ts.net/mcp
```

Użyj tego URL zamiast `http://localhost:3001/mcp` we wszystkich konfiguracjach IDE. Połączenie jest terminowane TLS przez infrastrukturę Tailscale — nie ma potrzeby zarządzania certyfikatami po twojej stronie.

### Kiedy to ma sens

Tailscale Funnel jest szczególnie przydatny gdy:
- Pracujesz na wielu maszynach i chcesz jednego wspólnego serwera pamięci
- Chcesz dostępu do wspomnień z urządzenia mobilnego lub zdalnego agenta
- Prowadzisz MemoryAI na domowym serwerze (np. Dell, NAS) i korzystasz z niego z laptopa

### Uwaga bezpieczeństwa

Tailscale Funnel czyni endpoint publicznie routowalnym. MemoryAI wymaga ważnego klucza API przy każdym żądaniu, więc nieautoryzowany dostęp jest blokowany na poziomie aplikacji. W razie podejrzenia kompromitacji — zrotuj klucz API.

---

## Konfiguracja

Cała konfiguracja odbywa się przez zmienne środowiskowe. Uruchom `bash scripts/setup.sh`, aby wygenerować `.env` z losowymi sekretami.

### Zmienne wymagane

| Zmienna | Opis |
|---------|------|
| `DATABASE_URL` | Connection string PostgreSQL (`postgres://user:pass@host:5432/db`) |
| `REDIS_URL` | Connection string Redis (`redis://:haslo@host:6379`) |
| `JWT_SECRET` | Sekret do podpisywania JWT — minimum 32 znaki |
| `ADMIN_API_KEY` | Główny klucz API pierwszego użytkownika admina |
| `POSTGRES_PASSWORD` | Hasło PostgreSQL (używane przez Docker Compose) |
| `REDIS_PASSWORD` | Hasło Redis (używane przez Docker Compose) |

### Provider embeddingów

Embeddingi przekształcają tekst w wektory na potrzeby wyszukiwania semantycznego. Wybierz jednego providera:

```env
# Ollama — lokalnie, prywatnie, bez kosztów API (domyślnie)
EMBEDDING_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_EMBED_MODEL=nomic-embed-text   # lub bge-m3 dla lepszej obsługi polskiego
EMBED_DIMENSIONS=768                   # ustaw 1024 przy użyciu bge-m3

# Google Gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=twój_klucz
GEMINI_EMBED_MODEL=text-embedding-004

# OpenAI
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=twój_klucz
OPENAI_EMBED_MODEL=text-embedding-3-small
```

### LLM do dystylacji

LLM dystylacyjny odczytuje surowe wiadomości z sesji i wyciąga z nich ustrukturyzowane fakty. Wywoływany w tle po zakończeniu sesji.

```env
# Lokalne Ollama — prywatnie, bez kosztów API
DISTILL_PROVIDER=ollama
DISTILL_MODEL=qwen2.5:7b              # zalecany; qwen2.5:3b dla mniejszego RAM

# Google Gemini Flash — szybki, niski koszt na sesję
DISTILL_PROVIDER=gemini
DISTILL_MODEL=gemini-2.0-flash-exp
GEMINI_API_KEY=twój_klucz

# Anthropic Claude Haiku — najwyższa jakość ekstrakcji faktów
DISTILL_PROVIDER=anthropic
DISTILL_MODEL=claude-haiku-4-5-20251001
ANTHROPIC_API_KEY=twój_klucz
```

### Harmonogram dystylacji

```env
# Uruchom dystylację po N minutach nieaktywności sesji (domyślnie: 15)
DISTILL_INACTIVITY_MINUTES=15

# Uruchom też co N wiadomości, niezależnie od czasu (0 = wyłączone)
DISTILL_EVERY_N_MESSAGES=50
```

### Rate limiting

```env
# Maksymalna liczba żądań na minutę na klucz API (domyślnie: 10000)
RATE_LIMIT_RPM=10000
```

### Sieć i CORS

```env
PORT=3001
HOST=0.0.0.0

# Lista dozwolonych origins CORS (oddzielona przecinkami)
CORS_ORIGINS=http://localhost:3000,https://twoja-aplikacja.example.com
```

---

## Narzędzia MCP — dokumentacja

Sześć narzędzi udostępnionych przez MCP. Opisy narzędzi są napisane jako instrukcje behawioralne, dzięki czemu modele wywołują je automatycznie — bez konieczności jawnego polecenia użytkownika.

### `memory_get_context`

**Automatyczne wyzwolenie:** Na początku każdej rozmowy.

Ładuje top-K wspomnień najbardziej trafnych dla bieżącego kontekstu sesji. Zwraca sformatowany blok wstrzykiwany do okna kontekstu modelu.

```json
{
  "query": "aktualny projekt i preferencje użytkownika",
  "limit": 10,
  "session_id": "opcjonalne-id-istniejącej-sesji"
}
```

Zwraca: tablicę wspomnień z treścią, typem, ważnością i tagami.

---

### `memory_save`

**Automatyczne wyzwolenie:** Gdy model poznaje coś ważnego.

Zapisuje jedno wspomnienie. Model powinien wywoływać to narzędzie po napotkaniu faktów, decyzji lub preferencji wartych utrwalenia.

```json
{
  "content": "Użytkownik preferuje TypeScript strict mode we wszystkich nowych projektach",
  "type": "preference",
  "importance": 0.8,
  "tags": ["typescript", "styl-kodu"],
  "session_id": "id-bieżącej-sesji"
}
```

---

### `memory_search`

**Automatyczne wyzwolenie:** Gdy model musi wyszukać konkretną informację z przeszłości.

Targetowane wyszukiwanie semantyczne po wszystkich zapisanych wspomnieniach. Bardziej precyzyjne niż `memory_get_context`.

```json
{
  "query": "decyzje architektoniczne bazy danych",
  "limit": 5,
  "type": "decision"
}
```

---

### `entity_save`

**Automatyczne wyzwolenie:** Gdy model poznaje informacje o osobie, projekcie, firmie lub systemie.

Tworzy lub aktualizuje encję w bazie wiedzy (upsert po nazwie). Encje akumulują fakty przez wiele sesji.

```json
{
  "name": "Serwer Dell",
  "type": "system",
  "facts": [
    "IP 192.168.1.100 przez Tailscale",
    "Uruchamia Docker, Ollama, n8n",
    "Główny cel deployment'u dla self-hosted projektów"
  ]
}
```

Typy encji: `person` (osoba), `project` (projekt), `company` (firma), `system` (system), `other` (inne).

---

### `entity_get`

**Automatyczne wyzwolenie:** Gdy model musi przypomnieć sobie informacje o znanej encji.

Pobiera wszystkie zapisane fakty dla encji o podanej nazwie.

```json
{
  "name": "Serwer Dell"
}
```

---

### `session_end`

**Automatyczne wyzwolenie:** Gdy użytkownik się żegna, zamyka czat lub sygnalizuje koniec pracy.

Zamyka bieżącą sesję i kolejkuje dystylację w tle. Wywoływane też automatycznie przez timer nieaktywności po `DISTILL_INACTIVITY_MINUTES` minutach bez aktywności.

```json
{
  "session_id": "id-bieżącej-sesji",
  "summary": "Opcjonalne krótkie podsumowanie tego, co zostało zrobione"
}
```

---

## Integracja z Open WebUI

MemoryAI integruje się z [Open WebUI](https://github.com/open-webui/open-webui) przez dwa komponenty w [`openwebui/`](openwebui/):

| Plik | Rola |
|------|------|
| `memoryai_filter.py` | **Globalny filtr** — automatycznie wstrzykuje wspomnienia do każdej rozmowy |
| `memoryai_tools.py` | **Narzędzia** — pozwala modelowi jawnie przeszukiwać/zapisywać pamięć |

### Jak działa filtr

**Na każdą wiadomość użytkownika (`inlet`):**
1. Wyszukuje wspomnienia powiązane z wiadomością
2. Wyszukuje encje (osoby, projekty, narzędzia)
3. Wstrzykuje blok `[MEMORYAI CONTEXT]` do system promptu
4. Zapisuje wiadomość do sesji MemoryAI (do późniejszej dystylacji)

**Po każdej odpowiedzi modelu (`outlet`):**
- Zapisuje odpowiedź asystenta do sesji
- Sesja jest dystylowana do długoterminowych wspomnień gdy staje się nieaktywna

### Instalacja

```bash
docker cp openwebui/memoryai_filter.py openwebui:/app/backend/data/memoryai_filter.py
docker cp openwebui/memoryai_tools.py  openwebui:/app/backend/data/memoryai_tools.py

# Następnie w UI Open WebUI:
# Admin → Functions → Dodaj filtr → wklej memoryai_filter.py
# Admin → Tools → Dodaj narzędzie → wklej memoryai_tools.py
```

### Valves (konfiguracja filtra)

| Parametr | Domyślnie | Opis |
|----------|-----------|------|
| `memoryai_url` | `http://localhost:3010` | Adres API MemoryAI |
| `memoryai_token` | — | Token Bearer z `ADMIN_API_KEY` |
| `max_memories` | `6` | Maks. wspomnień na zapytanie |
| `min_score` | `0.45` | Minimalny wynik trafności (0–1) |
| `inject_entities` | `true` | Wstrzykuj też fakty o encjach |
| `max_entities` | `3` | Maks. encji do wstrzyknięcia |
| `save_to_session` | `true` | Zapisuj wiadomości do dystylacji |

---

## Orkiestracja multi-agent

MemoryAI pełni rolę **wspólnej warstwy pamięci** dla workflow wieloagentowych. Wiele modeli AI może odczytywać i zapisywać do tego samego magazynu wspomnień, umożliwiając asynchroniczną współpracę między agentami.

### Lokalny serwer MCP dla Claude Code

[`integrations/claude-code/`](integrations/claude-code/) zawiera lokalny serwer MCP i narzędzie CLI dające Claude Code bezpośredni dostęp do **Gemini** (przez istniejącą sesję OAuth) i **lokalnych modeli Ollama** — bez kluczy API.

**Pliki:**

| Plik | Opis |
|------|------|
| `mcp-local-ai.py` | Serwer MCP (stdio) z narzędziami `ask_gemini`, `ask_model`, `ask_ollama`, `list_ai_models`, `list_ollama_models` |
| `ask-model.py` | Skrypt CLI do szybkich wywołań modeli z terminala |

**Konfiguracja:**

```bash
# Dodaj do .mcp.json w katalogu projektu
{
  "mcpServers": {
    "local-ai": {
      "type": "stdio",
      "command": "python3",
      "args": ["/ścieżka/do/mcp-local-ai.py"]
    }
  }
}
```

**Dostępne narzędzia po restarcie:**

```
mcp__local-ai__ask_gemini         — Pytaj Gemini (2.5 Flash domyślnie, przez OAuth)
mcp__local-ai__ask_model          — Pytaj dowolny model podłączony do Antigravity
mcp__local-ai__ask_ollama         — Pytaj lokalny model Ollama (qwen3.5:4b domyślnie)
mcp__local-ai__list_ai_models     — Lista modeli Gemini/Claude/GPT
mcp__local-ai__list_ollama_models — Lista lokalnych modeli Ollama
```

**Użycie CLI:**

```bash
python3 ask-model.py "Wyjaśnij tę funkcję" --model gemini-2.5-flash
python3 ask-model.py "Zrób code review" --model gemini-3.1-pro-high --system "Jesteś senior engineerem"
python3 ask-model.py --list-models
```

### Dobór modelu

| Zadanie | Zalecany model |
|---------|----------------|
| Analiza, rozumowanie | `gemini-2.5-flash` lub `gemini-3.1-pro-high` |
| Code review / generowanie kodu | `deepseek-coder-v2:16b` (Ollama) |
| Szybkie lokalne wywołanie | `qwen3.5:4b` (domyślny Ollama) |
| Złożone rozumowanie lokalne | `qwen2.5:14b` lub `mistral-nemo:latest` |
| Wizja / multimodal | `llama3.2-vision:11b` lub `qwen2.5vl:7b` |
| Weryfikacja / druga opinia | Inny model niż ten co dał pierwsze wyniki |

### Jak to działa technicznie

Serwer MCP **dynamicznie** wykrywa port i token CSRF serwera językowego Antigravity przy starcie — brak hardkodowanych wartości, działa po każdym restarcie.

```
Claude Code
  └─► mcp__local-ai__ask_gemini("zrób code review")
        └─► wywołanie ConnectRPC do Antigravity LS (127.0.0.1:44751)
              └─► GetModelResponse{model: MODEL_GOOGLE_GEMINI_2_5_FLASH}
                    └─► Google Cloud AI (przez istniejącą sesję OAuth)
                          └─► odpowiedź zwrócona do Claude

Claude Code
  └─► mcp__local-ai__ask_ollama("wyjaśnij algorytm")
        └─► HTTP POST do Ollama API (192.168.1.100:11434)
              └─► lokalna inferencja (brak internetu)
                    └─► odpowiedź zwrócona do Claude
```

---

## REST API — dokumentacja

Wszystkie endpointy wymagają: `Authorization: Bearer TWÓJ_KLUCZ_API`

Bazowy URL: `http://localhost:3001` (lub twój zdalny URL)

### Wspomnienia (Memories)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `POST` | `/v1/memories/search` | Hybrydowe wyszukiwanie semantyczne |
| `GET` | `/v1/memories` | Lista wspomnień (stronicowana) |
| `POST` | `/v1/memories` | Utwórz pojedyncze wspomnienie |
| `POST` | `/v1/memories/batch` | Utwórz wiele naraz (maks. 50 na żądanie) |
| `GET` | `/v1/memories/:id` | Pobierz wspomnienie po ID |
| `PATCH` | `/v1/memories/:id` | Zaktualizuj wspomnienie |
| `DELETE` | `/v1/memories/:id` | Usuń wspomnienie |

**Wyszukiwanie:**
```bash
curl -X POST http://localhost:3001/v1/memories/search \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{"query": "decyzje architektoniczne PostgreSQL", "limit": 5, "type": "decision"}'
```

**Tworzenie:**
```bash
curl -X POST http://localhost:3001/v1/memories \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "Zdecydowano użyć PostgreSQL z pgvector zamiast dedykowanej bazy wektorowej",
    "type": "decision",
    "importance": 0.9,
    "tags": ["projekt:memoryai", "tech:postgresql"]
  }'
```

**Tworzenie wsadowe:**
```bash
curl -X POST http://localhost:3001/v1/memories/batch \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{
    "memories": [
      {"content": "Użytkownik używa pnpm jako menedżera pakietów", "type": "preference", "importance": 0.6},
      {"content": "Node.js 20 LTS na wszystkich serwerach", "type": "fact", "importance": 0.7}
    ]
  }'
```

### Sesje (Sessions)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `GET` | `/v1/sessions` | Lista sesji (stronicowana) |
| `POST` | `/v1/sessions` | Utwórz nową sesję |
| `GET` | `/v1/sessions/:id` | Szczegóły sesji |
| `GET` | `/v1/sessions/:id/messages` | Historia wiadomości sesji |
| `POST` | `/v1/sessions/:id/messages` | Dodaj wiadomość do sesji |
| `POST` | `/v1/sessions/:id/close` | Zamknij sesję + uruchom dystylację |

**Tworzenie sesji:**
```bash
curl -X POST http://localhost:3001/v1/sessions \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{"context": "Praca nad dashboardem MemoryAI"}'
```

**Dodanie wiadomości:**
```bash
curl -X POST http://localhost:3001/v1/sessions/ID_SESJI/messages \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{"role": "user", "content": "Użyjmy React + Vite do dashboardu"}'
```

### Encje (Entities)

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `POST` | `/v1/entities/search` | Semantyczne wyszukiwanie encji |
| `GET` | `/v1/entities` | Lista encji |
| `POST` | `/v1/entities` | Utwórz/zaktualizuj encję (upsert po nazwie) |
| `GET` | `/v1/entities/by-name/:name` | Pobierz encję po nazwie |
| `POST` | `/v1/entities/:id/facts` | Dodaj fakt do istniejącej encji |
| `DELETE` | `/v1/entities/:id` | Usuń encję |

**Tworzenie encji:**
```bash
curl -X POST http://localhost:3001/v1/entities \
  -H "Authorization: Bearer TWÓJ_KLUCZ" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Serwer Dell",
    "type": "other",
    "facts": [
      {"content": "IP 192.168.1.100 przez Tailscale"},
      {"content": "Uruchamia Docker, Ollama i n8n"},
      {"content": "Główny cel deployment'u self-hosted projektów"}
    ]
  }'
```

### System

| Metoda | Ścieżka | Opis |
|--------|---------|------|
| `GET` | `/health` | Sprawdzenie stanu serwera |
| `GET` | `/mcp/config` | Pobierz snippety konfiguracji MCP dla wszystkich obsługiwanych IDE |

---

## Typy wspomnień i skala ważności

### Typy wspomnień

| Typ | Przeznaczenie | Przykład |
|-----|--------------|----------|
| `fact` | Ogólna informacja faktyczna | "Użytkownik używa TypeScript we wszystkich nowych projektach" |
| `decision` | Podjęta decyzja, z kontekstem | "Zdecydowano użyć PostgreSQL zamiast MongoDB — decydujące było wsparcie pgvector" |
| `preference` | Co użytkownik lubi lub nie lubi | "Użytkownik preferuje zwięzłe odpowiedzi bez podsumowań na końcu" |
| `instruction` | Reguła do zawsze przestrzegania | "Zawsze pisz commit messages po angielsku" |
| `entity_relation` | Relacja między rzeczami | "cenkier.pl jest wdrażany na LH.pl przez FTP" |
| `summary` | Podsumowanie sesji | "Sesja 2026-06-01: Zaprojektowano architekturę MemoryAI, wybrano Fastify + pgvector" |

### Skala ważności

| Zakres | Etykieta | Kiedy używać |
|--------|----------|-------------|
| `0.9–1.0` | Krytyczne | Instrukcje do bezwzględnego przestrzegania, nieodwracalne decyzje, kluczowe dane dostępowe |
| `0.7–0.8` | Ważne | Częste preferencje, fakty projektowe, aktywne ograniczenia |
| `0.5–0.6` | Normalne | Ogólny kontekst, informacje tła |
| `0.3–0.4` | Niskie | Drobne szczegóły, potencjalnie nieaktualne informacje |

Wspomnienia o wyższej ważności zajmują wyższe pozycje w wynikach wyszukiwania hybrydowego niezależnie od trafności semantycznej. Wartości `1.0` używaj oszczędnie — zarezerwuj je dla instrukcji, których model nigdy nie może złamać.

---

## Architektura

### Przegląd komponentów

```
memoryai/
├── packages/
│   ├── api/           Node.js + TypeScript + Fastify 5
│   │   └── src/
│   │       ├── config.ts            Konfiguracja env + walidacja Zod
│   │       ├── index.ts             Punkt startowy serwera + graceful shutdown
│   │       ├── db/pool.ts           Pula połączeń PostgreSQL
│   │       ├── middleware/          Middleware auth (klucz API → użytkownik)
│   │       ├── routes/              Endpointy REST (memories, sessions, entities)
│   │       ├── services/            Warstwa logiki biznesowej
│   │       │   ├── memory.service   CRUD + wyszukiwanie hybrydowe
│   │       │   ├── session.service  Cykl życia sesji + bufor wiadomości
│   │       │   ├── entity.service   Upsert encji + wyszukiwanie wektorowe
│   │       │   ├── embedding.service  Abstrakcja wielu providerów
│   │       │   └── auth.service     Zarządzanie kluczami API
│   │       ├── mcp/server.ts        MCP JSON-RPC przez HTTP/SSE
│   │       └── jobs/
│   │           ├── distillation.queue  Definicja kolejki BullMQ
│   │           └── distillation.worker Automatyczna ekstrakcja faktów
│   ├── dashboard/     Frontend React + Vite (w trakcie budowy)
│   ├── sdk/           TypeScript SDK dla klientów (w trakcie budowy)
│   └── shared/        Typy TypeScript współdzielone między pakietami
├── docker/
│   ├── docker-compose.yml   PostgreSQL 16+pgvector, Redis 7, serwis API
│   ├── Dockerfile.api       Wieloetapowy produkcyjny build Docker
│   └── postgres/init.sql    Schemat DB, indeksy, funkcje wyszukiwania
└── scripts/
    ├── setup.sh             Automatyczny setup pierwszego uruchomienia
    └── create-vector-index.sh  Opcjonalnie: buduje indeks HNSW po imporcie danych
```

### Schemat bazy danych

```sql
users             -- klucze API, wsparcie wielu użytkowników
projects          -- opcjonalne przestrzenie nazw dla wspomnień
sessions          -- śledzenie rozmów (open/closed/distilled)
session_messages  -- surowy bufor wiadomości używany jako wejście do dystylacji
memories          -- trwałe fakty z embeddingami wektorowymi + indeks BM25
entities          -- nazwane encje: osoby, projekty, firmy, systemy
distillation_jobs -- śledzenie asynchronicznych zadań (ID zadań BullMQ, status, błędy)
```

### Stack technologiczny

| Warstwa | Technologia |
|---------|------------|
| Serwer API | Node.js 20 + TypeScript + Fastify 5 |
| Baza danych | PostgreSQL 16 + rozszerzenie pgvector |
| Cache / Kolejka | Redis 7 + BullMQ |
| Transport MCP | HTTP + SSE (JSON-RPC 2.0) |
| Walidacja wejścia | Zod |
| Konteneryzacja | Docker Compose |
| Embeddingi | Ollama / Gemini / OpenAI (konfigurowalne) |
| Dystylacja | Ollama / Gemini Flash / Anthropic Claude Haiku (konfigurowalne) |

---

## Struktura projektu

```
memoryai/
├── .env.example                     Wszystkie zmienne konfiguracyjne z opisami
├── docker/
│   ├── docker-compose.yml           Serwisy PostgreSQL + Redis + API
│   ├── Dockerfile.api               Wieloetapowy build produkcyjny
│   └── postgres/
│       └── init.sql                 Schemat DB, indeksy wektorowe, funkcje wyszukiwania
├── packages/
│   ├── shared/                      Współdzielone typy TypeScript (Memory, Session, Entity)
│   ├── api/
│   │   └── src/
│   │       ├── config.ts            Typowana konfiguracja env z walidacją przy starcie
│   │       ├── index.ts             Aplikacja Fastify + obsługa graceful shutdown
│   │       ├── db/pool.ts           Pula PostgreSQL + helper transakcji
│   │       ├── middleware/
│   │       │   └── auth.middleware.ts   Klucz API → wyszukiwanie użytkownika
│   │       ├── routes/
│   │       │   ├── memories.route.ts    /v1/memories (CRUD + wyszukiwanie)
│   │       │   ├── sessions.route.ts    /v1/sessions (cykl życia + wiadomości)
│   │       │   └── entities.route.ts    /v1/entities (upsert + wyszukiwanie)
│   │       ├── services/
│   │       │   ├── memory.service.ts    Główne CRUD wspomnień + wyszukiwanie hybrydowe
│   │       │   ├── session.service.ts   Cykl życia sesji + bufor wiadomości
│   │       │   ├── entity.service.ts    Upsert encji + wyszukiwanie wektorowe
│   │       │   ├── embedding.service.ts Abstrakcja wielu providerów embeddingów
│   │       │   └── auth.service.ts      Tworzenie i walidacja kluczy API
│   │       ├── mcp/
│   │       │   └── server.ts            MCP JSON-RPC przez HTTP/SSE (6 narzędzi)
│   │       └── jobs/
│   │           ├── distillation.queue.ts   Definicja kolejki BullMQ
│   │           └── distillation.worker.ts  Ekstrakcja faktów przez LLM + harmonogram
│   ├── dashboard/                   Panel administracyjny React + Vite (w budowie)
│   └── sdk/                         SDK TypeScript @memoryai/client (w budowie)
├── scripts/
│   ├── setup.sh                     Automatyzacja pierwszego uruchomienia
│   └── create-vector-index.sh       Budowa indeksu HNSW po imporcie zbiorczym
└── README.md
```

---

## Wymagania systemowe

### Minimalne (development / lekkie użycie)

| Komponent | Minimum |
|-----------|---------|
| CPU | 2 rdzenie |
| RAM | **2 GB** (PostgreSQL 512 MB + Redis 256 MB + API 256 MB) |
| Dysk | **5 GB** (DB + indeksy + logi) |
| Node.js | **20 LTS** |
| Docker | 24+ z Compose v2 |
| PostgreSQL | 16+ przez obraz `pgvector/pgvector:pg16` |
| Redis | 7+ |

### Zalecane (produkcja / intensywne użycie)

| Komponent | Zalecane |
|-----------|---------|
| CPU | 4+ rdzenie |
| RAM | **8 GB** (zapas na duże partie embeddingów + indeks HNSW pgvector w pamięci) |
| Dysk | **50+ GB SSD** (rośnie ze wspomnieniami; wektor 768-dim ≈ 3 KB/wspomnienie) |
| Node.js | 20 LTS |

### Modele Ollama (lokalne embeddingi + dystylacja)

| Model | Typ | VRAM / RAM | Uwagi |
|-------|-----|-----------|-------|
| `nomic-embed-text` | Embedding | 274 MB | Domyślny — dobra jakość, obsługuje angielski i polski |
| `bge-m3` | Embedding | 570 MB | Najlepszy dla treści wielojęzycznych / z dużą ilością polskiego |
| `qwen2.5:7b` | Dystylacja | 4,7 GB | Zalecany — świetna ekstrakcja faktów |
| `qwen2.5:3b` | Dystylacja | 2,0 GB | Lżejsza alternatywa, nieco niższa jakość |
| `llama3.2:3b` | Dystylacja | 2,0 GB | Alternatywa skoncentrowana na angielskim |

> Ollama ładuje modele na żądanie i zwalnia je po przekroczeniu czasu bezczynności. Jednoczesne działanie embeddingu i dystylacji wymaga ok. 5–6 GB RAM/VRAM dla zalecanych modeli.

---

## Szacowane zasoby

### Wzrost zajętości dysku

| Metryka | Rozmiar |
|---------|---------|
| 1 wspomnienie (wektor 768-dim + tekst) | ~3–4 KB w PostgreSQL |
| 1 000 wspomnień | ~4 MB |
| 10 000 wspomnień | ~40 MB |
| 100 000 wspomnień | ~400 MB |
| 1 sesja (50 wiadomości) | ~50–200 KB |

Po roku aktywnego codziennego użycia (10 sesji/dzień, 5 wyekstrahowanych wspomnień/sesja): **~18 000 wspomnień ≈ ~72 MB**. Całkowicie zarządzalne na każdym współczesnym systemie.

### Zużycie pamięci RAM w czasie działania

| Serwis | RAM w bezczynności | RAM przy obciążeniu |
|--------|-------------------|---------------------|
| PostgreSQL + pgvector | ~100 MB | ~512 MB |
| Redis | ~10 MB | ~256 MB |
| MemoryAI API | ~80 MB | ~200 MB |
| Ollama (załadowany nomic-embed-text) | ~300 MB | ~500 MB |
| **Łącznie** | **~490 MB** | **~1,5 GB** |

### Opóźnienia sieciowe

| Operacja | Typowe opóźnienie |
|----------|------------------|
| Embedding (lokalny Ollama) | 10–50 ms |
| Embedding (Gemini API) | 100–300 ms |
| Dystylacja (Gemini Flash) | 500–2000 ms/sesję |
| Dystylacja (lokalny qwen2.5:7b, CPU) | 5–30 s/sesję |
| Dystylacja (lokalny qwen2.5:7b, GPU) | 1–5 s/sesję |
| Zapytanie wyszukiwania hybrydowego (PostgreSQL) | 5–20 ms |

---

## Szczegóły dystylacji

Dystylacja to proces przekształcania surowej historii wiadomości sesji w ustrukturyzowane, trwałe wspomnienia. Działa w tle przez BullMQ + Redis i nie blokuje API.

### Wyzwalacze

Dystylacja jest uruchamiana przez jeden z dwóch warunków — ten, który wystąpi pierwszy:

1. **Timer nieaktywności:** `DISTILL_INACTIVITY_MINUTES` (domyślnie: 15) minut bez nowych wiadomości w sesji
2. **Liczba wiadomości:** Co `DISTILL_EVERY_N_MESSAGES` wiadomości, niezależnie od czasu (jeśli skonfigurowane)

### Przebieg procesu

1. Sesja jest oznaczana jako `distilling`
2. Worker BullMQ pobiera zadanie z kolejki Redis
3. Worker pobiera wszystkie `session_messages` dla danej sesji
4. Prompt LLM prosi model dystylacyjny o wyekstrahowanie: faktów, decyzji, preferencji, instrukcji, relacji między encjami
5. Wyekstrahowane elementy są zapisywane jako `memories` i `entities` z odpowiednimi typami i ocenami ważności
6. Sesja jest oznaczana jako `distilled`
7. Surowe wiadomości są opcjonalnie przycinane (konfigurowalne), aby zaoszczędzić miejsce

### Naprawa błędu — ID zadań BullMQ

ID zadań BullMQ nie mogą zawierać dwukropków (`:`) — są używane jako separatory kluczy Redis. Wszystkie ID zadań dystylacji używają myślnika jako separatora: `distill-${sessionId}` zamiast `distill:${sessionId}`.

### Wskazówki dotyczące jakości

- **Gemini Flash** ma najlepszy stosunek ceny do jakości dystylacji w większości przypadków
- **Anthropic Claude Haiku** produkuje najbardziej ustrukturyzowane i otagowane wyjście
- **Lokalny qwen2.5:7b** jest w pełni prywatny i zaskakująco dobry przy polskich treściach
- Utrzymuj sesje skoncentrowane — jakość dystylacji spada przy bardzo długich, wielowątkowych rozmowach
- Prompt dystylacji znajduje się w `packages/api/src/jobs/distillation.worker.ts` i można go dostosować

---

## Bezpieczeństwo

### Uwierzytelnianie

- Wszystkie endpointy REST i MCP wymagają `Authorization: Bearer <klucz>`
- Klucze API to kryptograficznie losowe ciągi 48 znaków (nanoid)
- Klucz admina ustawiany jest przy starcie przez `ADMIN_API_KEY` — rotuj go, aktualizując zmienną i restartując serwis

### Izolacja danych

- Każde zapytanie do bazy danych jest ograniczone przez `user_id` — brak wycieku danych między użytkownikami
- `session_end` weryfikuje własność sesji przed zamknięciem
- `addMessage` weryfikuje własność sesji wewnątrz transakcji

### Zapobieganie SQL injection

- Wszystkie zapytania używają **parametryzowanych instrukcji** — zero interpolacji ciągów w SQL
- Zod waliduje wszystkie wejścia przed dotarciem do warstwy serwisowej
- Wartości enum (`type`, `status`) są walidowane przez Zod, nie interpolowane do zapytań

### Walidacja wejścia

- Wszystkie endpointy REST walidowane schematami Zod na poziomie route
- Argumenty narzędzi MCP walidowane przez jawne sprawdzanie typów przed przetworzeniem
- Limity długości ciągów na wszystkich polach tekstowych: maks. 10 000 znaków treści

### Rate limiting

- Domyślnie: 10 000 żądań na minutę na klucz API
- Konfigurowalne przez zmienną środowiskową `RATE_LIMIT_RPM`
- Wsparcie przez Redis za pomocą `@fastify/rate-limit`

### Nagłówki bezpieczeństwa

- `@fastify/helmet` dodaje standardowe nagłówki HTTP (CSP, HSTS, X-Frame-Options itp.)
- CORS ograniczony do jawnie dozwolonych origins przez zmienną `CORS_ORIGINS`

### Czego nie ma (v0.1)

- UI rejestracji użytkowników (admin tworzy użytkowników przez REST API)
- Logowanie OAuth2 / SSO
- Szyfrowanie wspomnień w spoczynku (użyj szyfrowania dysku na poziomie infrastruktury)
- Logi audytu

---

## Mapa drogowa

- [ ] **Dashboard React** (`packages/dashboard`) — przeglądanie wspomnień, edycja, wyszukiwanie, zadania dystylacji, analityka
- [ ] **Uniwersalny instalator IDE** (`/dashboard/install.py`) — auto-detekcja IDE i zapis konfiguracji MCP
- [ ] **TypeScript SDK** (`packages/sdk`, `@memoryai/client`) — łatwa integracja w każdej aplikacji Node.js
- [ ] **Python SDK** (`memoryai`) — dla środowisk Python, notebooków Jupyter, LangChain
- [ ] **Proxy middleware** — transparentny proxy kompatybilny z OpenAI API, automatycznie wstrzykujący kontekst pamięci
- [ ] **Konsolidacja wspomnień** — okresowe usuwanie duplikatów i scalanie podobnych wspomnień
- [ ] **Zarządzanie wieloma użytkownikami** — panel admina, rejestracja użytkowników, limity pamięci na użytkownika
- [ ] **Eksport / import** — kopia zapasowa i przywracanie wspomnień jako przenośny JSON
- [ ] **Zanikanie wspomnień** — automatyczne obniżanie ważności starych, nieużywanych wspomnień

---

## Licencja

MIT
