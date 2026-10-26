// SQL shared by the Tauri and Node repository implementations.
// Keep statements byte-identical to the originals; if the two drivers ever
// require different SQL, add a second constant and document the difference
// rather than silently diverging.

// accounts
export const SQL_FIND_ACCOUNT_ID = 'SELECT id FROM accounts ORDER BY id ASC LIMIT 1';
export const SQL_UPDATE_ACCOUNT =
  'UPDATE accounts SET provider=?,email=?,own_email=?,display_name=?,token_ref=? WHERE id=?';
export const SQL_INSERT_ACCOUNT =
  `INSERT INTO accounts (provider,email,own_email,display_name,token_ref,history_id,created_at)
   VALUES (?,?,?,?,?,NULL,?)`;
export const SQL_SELECT_ACCOUNT_BY_ID = 'SELECT * FROM accounts WHERE id=?';
export const SQL_SELECT_FIRST_ACCOUNT = 'SELECT * FROM accounts ORDER BY id ASC LIMIT 1';

// threads
export const SQL_UPSERT_THREAD =
  `INSERT INTO threads (account_id,provider_thread_id,subject,participants_json,labels_json,
     last_message_at,snippet,in_inbox)
   VALUES (?,?,?,?,?,?,?,?)
   ON CONFLICT(provider_thread_id) DO UPDATE SET subject=excluded.subject,
     participants_json=excluded.participants_json,labels_json=excluded.labels_json,
     last_message_at=excluded.last_message_at,snippet=excluded.snippet,
     in_inbox=excluded.in_inbox`;
export const SQL_SELECT_THREAD_BY_PROVIDER_ID = 'SELECT * FROM threads WHERE provider_thread_id=?';
export const SQL_LIST_THREADS = 'SELECT * FROM threads ORDER BY last_message_at DESC';
export const SQL_FIND_THREAD_ID = 'SELECT id FROM threads WHERE provider_thread_id=?';
export const SQL_DELETE_THREAD_BY_ROW_ID = 'DELETE FROM threads WHERE id=?';

// messages
export const SQL_DELETE_MESSAGE = 'DELETE FROM messages WHERE provider_message_id=?';
export const SQL_DELETE_MESSAGES_BY_THREAD = 'DELETE FROM messages WHERE thread_id=?';
export const SQL_UPSERT_MESSAGE =
  `INSERT INTO messages (thread_id,provider_message_id,rfc_message_id,references_json,
     from_json,to_json,cc_json,subject,body_text,body_html,has_list_unsubscribe,date,direction)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
   ON CONFLICT(provider_message_id) DO UPDATE SET rfc_message_id=excluded.rfc_message_id,
     references_json=excluded.references_json,from_json=excluded.from_json,to_json=excluded.to_json,
     cc_json=excluded.cc_json,subject=excluded.subject,body_text=excluded.body_text,
     body_html=excluded.body_html,has_list_unsubscribe=excluded.has_list_unsubscribe,
     date=excluded.date,direction=excluded.direction`;
export const SQL_LIST_MESSAGES = 'SELECT * FROM messages WHERE thread_id=? ORDER BY date ASC, id ASC';

// cards
export const SQL_DELETE_DRAFTS_BY_THREAD =
  'DELETE FROM drafts WHERE card_id IN (SELECT id FROM cards WHERE thread_id=?)';
export const SQL_DELETE_CARDS_BY_THREAD = 'DELETE FROM cards WHERE thread_id=?';
export const SQL_SHIFT_CARDS_FOR_INSERT = 'UPDATE cards SET position = position + 1 WHERE status = ?';
export const SQL_INSERT_CARD =
  'INSERT INTO cards (thread_id,status,position,updated_at) VALUES (?,?,0,?)';
export const SQL_SELECT_CARD_BY_ID = 'SELECT * FROM cards WHERE id=?';
export const SQL_SELECT_CARD_BY_THREAD = 'SELECT * FROM cards WHERE thread_id=?';
export const SQL_LIST_CARDS = 'SELECT * FROM cards ORDER BY status, position, id';
export const SQL_SELECT_CARD_POSITION = 'SELECT status, position FROM cards WHERE id=?';
export const SQL_TOUCH_CARD = 'UPDATE cards SET updated_at=? WHERE id=?';
export const SQL_SHIFT_CARDS_UP_RANGE =
  'UPDATE cards SET position = position + 1 WHERE status=? AND position >= ? AND position < ?';
export const SQL_SHIFT_CARDS_DOWN_RANGE =
  'UPDATE cards SET position = position - 1 WHERE status=? AND position > ? AND position <= ?';
export const SQL_SET_CARD_POSITION = 'UPDATE cards SET position=?, updated_at=? WHERE id=?';
export const SQL_CLOSE_CARD_GAP = 'UPDATE cards SET position = position - 1 WHERE status=? AND position > ?';
export const SQL_OPEN_CARD_GAP = 'UPDATE cards SET position = position + 1 WHERE status=? AND position >= ?';
export const SQL_MOVE_CARD_STATUS = 'UPDATE cards SET status=?, position=?, updated_at=? WHERE id=?';

// contacts
export const SQL_UPSERT_CONTACT =
  `INSERT INTO contacts (name,email,notes,do_not_contact,created_at) VALUES (?,?,?,?,?)
   ON CONFLICT(email) DO UPDATE SET name=excluded.name, notes=excluded.notes`;
export const SQL_SELECT_CONTACT_BY_EMAIL = 'SELECT * FROM contacts WHERE email=?';
export const SQL_LIST_CONTACTS = 'SELECT * FROM contacts ORDER BY created_at DESC, id DESC';
export const SQL_SET_DO_NOT_CONTACT = 'UPDATE contacts SET do_not_contact=? WHERE email=?';

// drafts
export const SQL_INSERT_DRAFT =
  `INSERT INTO drafts (card_id,contact_id,body,model,tone,instruction,is_chosen,created_at)
   VALUES (?,?,?,?,?,?,0,?)`;
export const SQL_SELECT_DRAFT_BY_ID = 'SELECT * FROM drafts WHERE id=?';
export const SQL_LIST_DRAFTS = 'SELECT * FROM drafts WHERE card_id=? ORDER BY created_at DESC, id DESC';
export const SQL_CHOOSE_DRAFT =
  'UPDATE drafts SET is_chosen = CASE WHEN id=? THEN 1 ELSE 0 END WHERE card_id=?';

// sends
export const SQL_INSERT_SEND = 'INSERT INTO sends (sent_at,kind,to_email,thread_id) VALUES (?,?,?,?)';
export const SQL_LIST_COLD_RECIPIENTS =
  `SELECT lower(to_email) AS email, MAX(sent_at) AS last_sent_at
     FROM sends WHERE kind='cold'
    GROUP BY lower(to_email)
    ORDER BY last_sent_at DESC`;
export const SQL_LIST_COLD_THREAD_IDS =
  "SELECT thread_id, lower(to_email) AS to_email FROM sends WHERE kind='cold' AND thread_id IS NOT NULL";
export const SQL_COUNT_SENDS_SINCE = 'SELECT COUNT(*) AS n FROM sends WHERE kind=? AND sent_at>=?';
export const SQL_HAS_COLD_SEND_TO =
  "SELECT COUNT(*) AS n FROM sends WHERE kind='cold' AND to_email=?";

// settings
export const SQL_GET_SETTING = 'SELECT value FROM settings WHERE key=?';
export const SQL_UPSERT_SETTING =
  `INSERT INTO settings (key,value) VALUES (?,?)
   ON CONFLICT(key) DO UPDATE SET value=excluded.value`;
