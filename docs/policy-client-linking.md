# How policies are linked to clients

## Summary

**Policies are linked to clients only by ID (UUID), never by name.**  
Each client is a separate row in `clients` with a unique `id`. Each policy has a `clientId` that points to exactly one client. Two different people with the same first and last name are two different client records and must never be treated as the same person unless you explicitly assign the same policy to the wrong client.

---

## 1. Database link

- **`policies.clientId`** → **`clients.id`** (UUID, foreign key).
- One client can have many policies.
- One policy has exactly one policy holder (one `clientId`).

So the only "link" is: **policy A belongs to client X** means `policy.clientId = client.id`. Names are not used for linking.

---

## 2. Client portal (who sees what)

- **Login**: Client enters **policy number** + **password**.
- System finds the **policy** by number, then loads the **client** via `policy.clientId`.
- Session stores `clientId` (and `clientOrgId`). All portal data (policies, payments, claims, etc.) is filtered by that **client ID**.
- So the person who sees a policy is whoever's **client record** is stored in `policy.clientId`. If that was set to the wrong person when the policy was created, the wrong person will see it (and the right person won't).

Identity in the portal is therefore: **policy number → policy → clientId → one client**. Same names elsewhere are irrelevant.

---

## 3. Claim / enrollment (activation)

- User enters **activation code** + **policy number**.
- System finds the **client** by activation code (`getClientByActivationCode`).
- System finds the **policy** by policy number.
- It then checks **`policy.clientId === client.id`**. Both must match: the code identifies the client, and the policy must belong to that client.
- So activation links a **specific client record** to a **specific policy**; again, no matching by name.

---

## 4. Where mix-ups can happen (same name, different person)

Linking is not done by name, but **who gets chosen as the policy holder** is:

- When **staff create a policy**, they pick the "Policy holder (client)" via **client search**.
- Search is by **first name, last name, email, phone** (see `getClientsByOrg` with `search`). So searching "John Smith" can return **multiple clients** (multiple people with that name).
- Staff then **choose one row** from the list. The UI used to show mainly **name + email**. If two people have the same name and no (or same) email, it's easy to pick the wrong one.
- The chosen client's **`id`** is sent as `clientId` when creating the policy. So the policy gets linked to whichever client was selected, not "the right John Smith" by name.

So **"two clients are linked"** in the sense of "wrong person sees a policy" usually means:

- **One policy was created with the wrong client selected** (e.g. Policy for John Smith A was created with John Smith B selected as policy holder). Then when John Smith B logs in, they see that policy; John Smith A does not.

It can also mean:

- **Duplicate client records** for the same person (e.g. two "John Smith" records). Then one person might have policies under two client IDs and would need to log in with different policy numbers to see each set. That's not really "linking" two different people, but it can look confusing.

---

## 5. Activation code

- Each new client gets an **activation code** at creation (e.g. `ACT-XXXXXX`).
- **`getClientByActivationCode`** returns the first client (in the tenant) with that code. The schema does **not** enforce uniqueness of `activation_code` per organization, so in theory two clients could have the same code (e.g. if set manually or by a bug). Then the wrong person could pass the claim step for a policy that belongs to the other. So activation codes should be **unique per organization** in practice (and ideally in the DB).

---

## 6. Recommendations

1. **When creating a policy**: Always confirm you have selected the **correct** client when multiple people share the same name. Use the client search and the extra identifiers (phone, national ID) shown in the dropdown to tell them apart.
2. **Activation codes**: Prefer making `(organizationId, activation_code)` unique (e.g. unique index where `activation_code IS NOT NULL`) and generating a new code until unique when creating a client.
3. **Client search**: Show **phone** and **national ID** (when available) in the client search dropdown so staff can distinguish "John Smith" from "John Smith" reliably.
4. **Data entry**: Encourage capturing **national ID** (and phone) for each client so that search and display can use them to avoid assigning a policy to the wrong person.

---

## 7. Quick reference

| Action                    | How client is identified / linked                          |
|---------------------------|------------------------------------------------------------|
| Policy → client           | `policy.clientId` = `clients.id` (UUID only)               |
| Portal login              | Policy number → policy → `policy.clientId` → session       |
| Portal data (policies etc.) | All filtered by session `clientId`                       |
| Claim / enrollment        | Activation code → client; policy number → policy; check `policy.clientId === client.id` |
| Staff create policy       | Staff picks one client from search; that client's `id` becomes `policy.clientId` |
| Client search             | By name, email, phone (no name-only "merge" or automatic link) |

So: **clients are not linked by name; they are linked only by the client UUID stored on the policy and used in the portal and enrollment flows.** The main risk is choosing the wrong client when creating a policy when several clients share the same name.
