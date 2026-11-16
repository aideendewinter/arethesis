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

export const INITIAL_DOC = `# Launch plan

Arethesis 0.1 ships with a normalized store, config-driven HTTP,
live updates over SSE and WebSockets, and collaborative editing.

## Checklist
- Final pass on the docs
- Record the demo video
- Announce it!

Open this page in a second window and type in both.
`;
