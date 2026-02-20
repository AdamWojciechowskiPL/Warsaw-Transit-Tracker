# 🚆🚌 Warsaw Transit Tracker

Aplikacja webowa wspierająca codzienne dojazdy z przesiadką – pociąg WKD → autobus ZTM. Analizuje rozkłady jazdy i dane na żywo, a następnie rekomenduje najlepszą kombinację połączeń, minimalizując ryzyko spóźnienia.

Aplikacja dostępna pod adresem: **https://development--warsaw-transit-tracker.netlify.app/**

---

## 📌 Opis

Warsaw Transit Tracker rozwiązuje konkretny problem: kiedy wyjść z pociągu i na który przystanek autobusu się udać, by zdążyć na połączenie i nie stać zbędnie na mrozie?

Aplikacja pobiera dane o odjazdach z publicznego API komunikacji miejskiej, przetwarza je po stronie serwera i prezentuje użytkownikowi czytelne rekomendacje – z uwzględnieniem:

- **danych live** (aktualne opóźnienia pojazdów)
- **wariantów przystanków** (np. linia 401 może odjeżdżać z dwóch różnych miejsc)
- **indywidualnych czasów dojścia** między miejscami przesiadki
- **buforów bezpieczeństwa** konfigurowanych przez użytkownika

---

## ✨ Funkcjonalności MVP

- 🔐 **Konta użytkowników** (Netlify Identity) – konfiguracja synchronizowana między urządzeniami
- 📋 **Profile tras** – możliwość zapisania wielu tras (np. „Do pracy", „Na uczelnię")
- 🕐 **Dashboard z rekomendacjami** – TOP propozycja + lista alternatyw z oceną ryzyka
- 🚏 **Obsługa wariantów przystanku** – wyraźna informacja, na który przystanek iść (A czy B)
- 📡 **Dane live vs. rozkład** – porównanie, opóźnienie, ostrzeżenia przy braku danych live
- 🔄 **Auto-refresh** co 20–30 sekund
- ⚙️ **Konfiguracja trasy** – ID przystanków, linie, czasy dojść, bufory

---

## 🏗️ Architektura

```
┌─────────────────────────────────────┐
│           Przeglądarka              │
│         React SPA / PWA             │
│     (Netlify – statyczny build)     │
└────────────────┬────────────────────┘
                 │ REST API (JWT)
┌────────────────▼────────────────────┐
│        Netlify Functions            │
│         Node.js / TypeScript        │
│                                     │
│  • Proxy do API komunikacji miejskiej│
│  • Algorytm rekomendacji            │
│  • Walidacja JWT (Netlify Identity) │
│  • Cache in-memory                  │
└──────┬─────────────────┬────────────┘
       │                 │
┌──────▼──────┐  ┌───────▼────────────┐
│    Neon     │  │  Zewnętrzne API    │
│ PostgreSQL  │  │  komunikacji       │
│             │  │  miejskiej WKD/ZTM │
│ • Użytkownicy│  └────────────────────┘
│ • Profile   │
│ • Segmenty  │
│ • Konfiguracja│
└─────────────┘
```

### Stack technologiczny

| Warstwa | Technologia |
|---------|------------|
| Frontend | React + TypeScript + Vite |
| Backend | Netlify Functions (Node.js + TypeScript) |
| Baza danych | Neon (PostgreSQL serverless) |
| Auth | Netlify Identity (JWT) |
| Hosting | Netlify |
| Walidacja | Zod |

---

## 🔌 Źródło danych

Dane o odjazdach (rozkład + live) są pobierane z publicznego API komunikacji miejskiej Warszawy obsługującego zarówno linie WKD (pociąg podmiejski), jak i ZTM (autobusy, tramwaje).

> ⚠️ **Ważne:** Wywołania do zewnętrznego API wykonuje wyłącznie backend (Netlify Functions). Przeglądarka nie komunikuje się bezpośrednio ze źródłem danych – zapobiega to problemom CORS i chroni przed limitami API.

### Różnice WKD vs. ZTM w danych live

| Właściwość | WKD | ZTM |
|------------|-----|-----|
| `departure_time_live` | Często niedostępne | Zazwyczaj dostępne |
| `vehicle_id` | Często niedostępne | Zazwyczaj dostępne |
| Cechy pojazdu (klimatyzacja, niska podłoga) | ❌ | ✅ |

---

## ⚙️ Konfiguracja trasy

Użytkownik ręcznie podaje:
- **ID przystanków** (np. `wkd_wrako` dla WKD, `325402` dla ZTM)
- **Linie**, które chce uwzględnić (np. `189`, `401`)
- **Warianty przystanku** dla tej samej linii (np. linia 401: przystanek A przy parkingu, przystanek B po stronie Biedronki)
- **Czasy dojścia** od peronu WKD do każdego wariantu przystanku (w minutach)
- **Bufory bezpieczeństwa** (czas potrzebny na wyjście z pociągu, minimalny bufor przesiadki)

---

## 🧠 Algorytm rekomendacji

1. Pobierz najbliższe odjazdy pociągów WKD (5–10 kandydatów)
2. Dla każdego pociągu oblicz `ready_sec` = czas odjazdu pociągu + czas wyjścia + czas dojścia do przystanku
3. Znajdź pierwszy autobus odjeżdżający **po** `ready_sec`
4. Oblicz `buffer_sec` = czas odjazdu autobusu – `ready_sec`
5. Oceń ryzyko:
   - 🟢 **LOW** – bufor > 5 min
   - 🟡 **MED** – bufor 2–5 min
   - 🔴 **HIGH** – bufor < 2 min lub brak danych live
6. Zwróć TOP N opcji posortowanych według scoringu

---

## 🗄️ Model danych

```
app_user          → konto użytkownika (mapowanie do Netlify Identity)
route_profile     → profil trasy (np. "Do pracy")
route_segment     → segmenty trasy (TRAIN → WALK → BUS) w kolejności
transfer_config   → czasy dojść i bufory per profil
```

Migracje DDL znajdują się w katalogu [`/migrations`](./migrations).

---

## 🚀 Uruchomienie lokalne

### Wymagania

- Node.js 18+
- Netlify CLI (`npm install -g netlify-cli`)
- Dostęp do bazy Neon PostgreSQL

### Instalacja

```bash
# Klonowanie repozytorium
git clone https://github.com/AdamWojciechowskiPL/Warsaw-Transit-Tracker.git
cd Warsaw-Transit-Tracker

# Instalacja zależności
npm install

# Konfiguracja zmiennych środowiskowych
cp .env.example .env
# Uzupełnij .env: DATABASE_URL, itp.

# Uruchomienie lokalnie (frontend + functions)
netlify dev
```

Aplikacja będzie dostępna pod adresem `http://localhost:8888`.

### Migracja bazy danych

```bash
# Uruchom migracje SQL w Neon
psql $DATABASE_URL -f migrations/001_initial.sql
```

---

## 📁 Struktura projektu

```
Warsaw-Transit-Tracker/
├── src/                    # Frontend (React + TypeScript)
│   ├── components/         # Komponenty UI
│   ├── pages/              # Widoki (Dashboard, Settings, Login)
│   └── lib/                # Utilities, API client
├── netlify/
│   └── functions/          # Backend (Netlify Functions)
│       └── api/            # Handlery API v1
├── migrations/             # DDL SQL
├── .env.example            # Przykładowa konfiguracja
├── netlify.toml            # Konfiguracja Netlify
├── vite.config.ts          # Konfiguracja Vite
└── tsconfig.json           # Konfiguracja TypeScript
```

---

## 🔒 Zmienne środowiskowe

| Zmienna | Opis |
|---------|------|
| `DATABASE_URL` | Connection string do Neon PostgreSQL |
| `NETLIFY_IDENTITY_*` | Klucze Netlify Identity (automatycznie w Netlify) |

> Żadne sekrety nie trafiają do kodu frontendu.

---

## 📋 Status implementacji

### ✅ Faza 1 – Infrastruktura
- Projekt Netlify z CI/CD
- Baza Neon + migracje DDL
- Netlify Identity
- Environment variables

### 🔄 Faza 2 – Backend MVP
- Proxy do API komunikacji miejskiej
- Normalizacja DTO (WKD/ZTM → jeden format)
- Walidacja JWT
- CRUD profile i segmenty
- Algorytm rekomendacji
- Cache in-memory

### 🔄 Faza 3 – Frontend MVP
- Dashboard z rekomendacjami
- Szczegóły opcji przesiadki
- Ustawienia profilu i trasy
- Auto-refresh

### ⏳ Faza 4 – Walidacja i Polish
- Walidacja semantyczna ID przystanków
- Obsługa błędów (brak live, timeout)
- Testy integracyjne

---

## 🔮 Planowane rozszerzenia (poza MVP)

- Wyszukiwarka przystanków (autocomplete)
- Powiadomienia push (PWA)
- Statystyki opóźnień i trendy
- Tryb offline
- Obsługa większej liczby tras

---

## 📄 Licencja

Projekt prywatny. Wszelkie prawa zastrzeżone.
