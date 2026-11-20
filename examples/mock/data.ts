/** Deterministic fake data for the demos. */

export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Alice', 'Amir', 'Anya', 'Arjun', 'Astrid', 'Bob', 'Beatriz', 'Bilal', 'Bianca', 'Bruno', 'Carol', 'Chidi', 'Clara', 'Cyrus', 'Camila', 'Dave', 'Dalia', 'Dmitri', 'Daniela', 'Desmond', 'Earnest', 'Elif', 'Emeka', 'Esther', 'Enzo', 'Forrest', 'Fatima', 'Felix', 'Freya', 'Farid', 'Garth', 'Gabriela', 'Gideon', 'Greta', 'Gustavo', 'Heidi', 'Hamza', 'Hana', 'Hugo', 'Hiroshi', 'Ivan', 'Imani', 'Ingrid', 'Isaac', 'Ishaan', 'Judy', 'Jamal', 'Jia', 'Joaquín', 'Juno', 'Kevin', 'Kavya', 'Kofi', 'Kira', 'Kai', 'Laura', 'Leon', 'Lucía', 'Lars', 'Leila', 'Mallory', 'Malik', 'Marta', 'Mohan', 'Mira', 'Nancy', 'Nikhil', 'Nadia', 'Nils', 'Nia', 'Olivia', 'Oscar', 'Oluwaseun', 'Orla', 'Omar', 'Peggy', 'Pablo', 'Priya', 'Pieter', 'Paloma', 'Quentin', 'Qing', 'Quinn', 'Quincy', 'Qadira', 'Rupert', 'Rania', 'Ravi', 'Rosa', 'Ruben', 'Sybil', 'Santiago', 'Sakura', 'Samir', 'Signe', 'Trent', 'Tariq', 'Thandiwe', 'Tomás', 'Tova', 'Ursula', 'Umar', 'Uma', 'Ulrich', 'Ulla', 'Victor', 'Valentina', 'Vikram', 'Vera', 'Vusi', 'Walter', 'Wanjiru', 'Wei', 'Wilhelmina', 'Wyatt', 'Xavier', 'Ximena', 'Xiu', 'Xander', 'Xola', 'Yolanda', 'Yusuf', 'Yara', 'Yuki', 'Yosef', 'Zelda', 'Zain', 'Zofia', 'Zhen', 'Zuri'];
const LAST = ['Lovelace', 'Hopper', 'Turing', 'Johnson', 'Torvalds', 'Hamilton', 'Berners-Lee', 'Liskov', 'Ritchie', 'Perlman', 'Thompson', 'Allen', 'Dijkstra', 'Lamarr', 'Knuth', 'Easley', 'van Rossum', 'Wilson', 'Stroustrup', 'Goldwasser', 'Matsumoto', 'Clarke', 'Eich', 'Conway', 'Hejlsberg', 'Keller', 'Lerdorf', 'Boyd', 'Gosling', 'Shaw', 'Wirth', 'Sammet', 'Lamport', 'Goldberg', 'Kernighan', 'Rhodes', 'Diffie', 'Okafor', 'Nakamoto', 'Raman', 'García', 'Mensah', 'Sato', 'Ahmed', 'Haddad', 'Silva', 'Novak', 'Rahman', 'Bianchi', 'Chen', 'Babbage', 'Boole', 'Shannon', 'von Neumann', 'Church', 'Kay', 'McCarthy', 'Backus', 'Hoare', 'Milner', 'Cerf', 'Kahn', 'Engelbart', 'Sutherland', 'Floyd', 'Tarjan', 'Hellman', 'Rivest', 'Shamir', 'Adleman', 'Cook', 'Karp', 'Valiant', 'Hartmanis', 'Codd', 'Gray', 'Stonebraker', 'Ullman', 'Aho', 'Hennessy', 'Patterson', 'Lampson', 'Minsky', 'Hinton', 'Pearl', 'Rabin', 'Scott', 'Naur', 'Iverson', 'Newell', 'Perlis', 'Corbató', 'Cocke', 'Smith', 'Nguyen', 'Kim', 'Park', 'Singh', 'Patel', 'Kumar', 'Müller', 'Schmidt', 'Rossi', 'Russo', 'Ferrari', 'Dubois', 'Martin', 'Bernard', 'Moreau', 'Kowalski', 'Ivanova', 'Petrov', 'Popescu', 'Horvat', 'Jensen', 'Hansen', 'Larsen', 'Andersson', 'Nilsson', 'Virtanen', 'Korhonen', 'O\'Brien', 'Murphy', 'Kelly', 'Walsh', 'Byrne', 'MacLeod', 'Campbell', 'Evans', 'Jones', 'Davies', 'Williams', 'Brown', 'Taylor', 'Moore', 'Martinez', 'Lopez', 'Gonzalez', 'Hernandez', 'Pereira', 'Santos', 'Costa', 'Oliveira', 'Fernandes', 'Mendoza', 'Torres', 'Vargas', 'Castillo', 'Romero', 'Alvarez', 'Yamamoto', 'Tanaka', 'Watanabe', 'Suzuki', 'Kobayashi', 'Lee', 'Wang', 'Zhang', 'Liu', 'Huang', 'Zhao', 'Wu', 'Tran', 'Pham', 'Le', 'Nakamura', 'Choi', 'Jung', 'Kang', 'Yilmaz', 'Demir', 'Kaya', 'Çelik', 'Öztürk', 'Hosseini', 'Karimi', 'Farouk', 'Nasser', 'Mahmoud', 'Abdi', 'Adeyemi', 'Okonkwo', 'Mwangi', 'Otieno', 'Kamau', 'Banda', 'Nkosi', 'Dlamini', 'Diallo', 'Traoré', 'Boateng', 'Asante', 'Owusu', 'Iyer', 'Menon', 'Reddy', 'Nair', 'Gupta', 'Shah', 'Das', 'Bose', 'Mehta', 'Joshi', 'Kapoor', 'Fischer', 'Weber', 'Wagner', 'Becker', 'Hoffmann', 'Schulz', 'de Vries', 'Jansen', 'Bakker', 'Visser', 'Peeters', 'Janssens', 'Lambert', 'Fontaine', 'Leclerc', 'Novák', 'Dvořák', 'Horváth', 'Nagy', 'Kovács', 'Papadopoulos', 'Georgiou', 'Cohen', 'Levi', 'Friedman', 'Andrade', 'Ribeiro', 'Quispe', 'Mamani', 'Flores', 'Rojas', 'Navarro', 'Ortega', 'Delgado', 'Morales', 'Akhtar', 'Hussain', 'Qureshi', 'Siddiqui', 'Malik', 'Ito', 'Takahashi', 'Ong', 'Tan', 'Lim', 'Goh', 'Reyes', 'Cruz', 'Bautista', 'Ramos', 'Aquino', 'Kealoha', 'Begay', 'Yazzie', 'Tsosie', 'Lindqvist', 'Berg', 'Holm', 'Eriksen', 'Halvorsen', 'Kristiansen'];
export const DEPARTMENTS = ['Engineering', 'Design', 'Product', 'Research', 'Marketing', 'Sales', 'Support', 'Finance'];
export const ROLES = ['Lead', 'Senior', 'Mid-level', 'Junior', 'Intern'];
const CITIES = ['Lisbon', 'Nairobi', 'Toronto', 'Seoul', 'Berlin', 'São Paulo', 'Melbourne', 'Austin', 'Dublin', 'Bangalore'];

export interface Person {
  id: number;
  name: string;
  email: string;
  department: string;
  role: string;
  salary: number;
  startDate: string;
  city: string;
  updatedAt: string;
}

/** Chance of keeping a full name that is already taken. */
const DUPLICATE_NAME_CHANCE = 0.02;

export function generatePeople(count: number, seed = 7): Person[] {
  const r = rng(seed);
  const pick = <T>(list: T[]): T => list[Math.floor(r() * list.length)];
  const people: Person[] = [];
  const usedNames = new Set<string>();
  for (let i = 1; i <= count; i++) {
    // Redraw names already taken, so a shared full name is rare but possible.
    let first = pick(FIRST);
    let last = pick(LAST);
    for (let tries = 0; usedNames.has(`${first} ${last}`) && r() > DUPLICATE_NAME_CHANCE && tries < 20; tries++) {
      first = pick(FIRST);
      last = pick(LAST);
    }
    usedNames.add(`${first} ${last}`);
    const role = pick(ROLES);
    const base = { Lead: 150000, Senior: 120000, 'Mid-level': 95000, Junior: 70000, Intern: 40000 }[role] ?? 80000;
    const start = new Date(2012 + Math.floor(r() * 14), Math.floor(r() * 12), 1 + Math.floor(r() * 28));
    people.push({
      id: i,
      name: `${first} ${last}`,
      email: `${first}.${last}`.normalize('NFD').toLowerCase().replace(/[^a-z.]/g, '') + `${i}@example.com`,
      department: pick(DEPARTMENTS),
      role,
      salary: Math.round((base + r() * 30000) / 500) * 500,
      startDate: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      city: pick(CITIES),
      updatedAt: new Date(2026, 0, 1).toISOString(),
    });
  }
  return people;
}

export type TaskStatus = 'backlog' | 'doing' | 'review' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  order: number;
  label: 'feature' | 'bug' | 'chore' | 'docs';
  assignee: string;
  updatedAt: string;
}

export function generateTasks(): Task[] {
  const items: Array<[string, TaskStatus, Task['label'], string]> = [
    ['Design the onboarding flow', 'backlog', 'feature', 'Bob'],
    ['Write API reference for ListViews', 'backlog', 'docs', 'Alice'],
    ['Investigate flaky reconnect test', 'backlog', 'bug', 'Carol'],
    ['Dark mode for the settings page', 'backlog', 'feature', 'Dave'],
    ['Infinite scroll for the activity feed', 'doing', 'feature', 'Earnest'],
    ['Fix date picker off-by-one', 'doing', 'bug', 'Forrest'],
    ['Upgrade build tooling', 'doing', 'chore', 'Garth'],
    ['Keyboard reordering for the board', 'review', 'feature', 'Heidi'],
    ['Sanitize pasted rich text', 'review', 'bug', 'Ivan'],
    ['Release notes for 0.1', 'done', 'docs', 'Alice'],
    ['Optimistic updates with rollback', 'done', 'feature', 'Bob'],
    ['Collaborative editor prototype', 'done', 'feature', 'Judy'],
  ];
  const counters: Record<string, number> = {};
  return items.map(([title, status, label, assignee], i) => {
    counters[status] = (counters[status] ?? 0) + 1;
    return { id: `t${i + 1}`, title, status, order: counters[status] * 1000, label, assignee, updatedAt: new Date(2026, 0, 1).toISOString() };
  });
}

export const INITIAL_DOC = `# Περὶ ἀρετῆς: notes for the symposium

> Can virtue be taught? Or is it got by practice, or does it come by nature?
> (Meno's opening question, *Meno* 70a, paraphrased)

## Agenda
1. Socrates opens with the question
2. Meno tries a definition, then another
3. The slave boy and the doubled square
4. Wine, and whatever Aristophanes brings

## Positions so far
- **Meno**: virtue is being able to rule over others
- **Gorgias**, by proxy: a different virtue for every role in life
- **Socrates**: we don't yet know what virtue *is*, so how can we say how it's got?

## To do
- [x] Book the andron for twelve couches
- [ ] Ask Diotima whether she'll speak
- [ ] Find a better English word than "virtue" for *aretē*

## Seating
| Guest | Bringing | Couch |
|:--|:--|--:|
| Phaedrus | figs | 1 |
| Agathon | wine | 2 |
| Aristophanes | jokes | 3 |

Open this page in a second window and type in both, or let Socrates join.
`;

/**
 * The treasury ledger: tribute (phoros) owed to the Delian League, in
 * talents. The poleis are real members; the figures are illustrative.
 */
export function treasuryCells(): Record<string, string> {
  const rows: Array<[string, string, number, boolean]> = [
    ['Aegina', 'Islands', 30, true],
    ['Thasos', 'Thrace', 30, true],
    ['Paros', 'Islands', 18, true],
    ['Byzantium', 'Hellespont', 15, false],
    ['Abdera', 'Thrace', 15, true],
    ['Lampsacus', 'Hellespont', 12, true],
    ['Naxos', 'Islands', 6.67, false],
    ['Andros', 'Islands', 6, true],
    ['Miletus', 'Ionia', 5, true],
    ['Ephesus', 'Ionia', 7.5, true],
    ['Erythrae', 'Ionia', 7, false],
    ['Lindos', 'Caria', 8.5, true],
  ];
  const cells: Record<string, string> = {
    A1: 'Polis', B1: 'Region', C1: 'Tribute (talents)', D1: 'In drachmae', E1: 'Paid', F1: 'Share of total',
  };
  rows.forEach(([polis, region, talents, paid], i) => {
    const r = i + 2;
    cells[`A${r}`] = polis;
    cells[`B${r}`] = region;
    cells[`C${r}`] = String(talents);
    cells[`D${r}`] = `=C${r}*6000`;
    cells[`E${r}`] = paid ? 'TRUE' : 'FALSE';
    cells[`F${r}`] = `=ROUND(C${r}/C$15*100, 1)`;
  });
  Object.assign(cells, {
    A15: 'Total', C15: '=SUM(C2:C13)', D15: '=SUM(D2:D13)',
    A16: 'Average', C16: '=ROUND(AVERAGE(C2:C13), 2)',
    A17: 'Largest', C17: '=MAX(C2:C13)',
    A18: 'Poleis paying', C18: '=COUNT(C2:C13)', D18: '=IF(C15>150, "Treasury healthy", "Send the triremes")',
  });
  return cells;
}
