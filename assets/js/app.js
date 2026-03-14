import { auth, db } from './firebase-config.js';
import { onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch
} from 'https://www.gstatic.com/firebasejs/12.10.0/firebase-firestore.js';

const elements = {
  form: document.getElementById('transaction-form'),
  list: document.getElementById('transaction-list'),
  clearButton: document.getElementById('clear-btn'),
  logoutButton: document.getElementById('logout-btn'),
  authLink: document.getElementById('auth-link'),
  userEmail: document.getElementById('user-email'),
  pageMessage: document.getElementById('page-message'),
  balance: document.getElementById('balance'),
  income: document.getElementById('total-income'),
  expense: document.getElementById('total-expense')
};

const transactionFields = {
  description: document.getElementById('description'),
  amount: document.getElementById('amount'),
  category: document.getElementById('category'),
  type: document.getElementById('type')
};

let transactions = [];
let currentUser = null;
let unsubscribeTransactions = null;

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

function setPageMessage(text = '', type = '') {
  elements.pageMessage.textContent = text;
  elements.pageMessage.className = 'page-message';

  if (type) {
    elements.pageMessage.classList.add(type);
  }
}

function updateSummary() {
  const income = transactions
    .filter((transaction) => transaction.type === 'income')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expense = transactions
    .filter((transaction) => transaction.type === 'expense')
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const balance = income - expense;

  elements.balance.textContent = formatCurrency(balance);
  elements.balance.className = `card-amount ${balance >= 0 ? 'positive' : 'negative'}`;
  elements.income.textContent = formatCurrency(income);
  elements.expense.textContent = formatCurrency(expense);
}

function renderList() {
  if (transactions.length === 0) {
    elements.list.innerHTML = '<li class="empty-state">No transactions yet. Add one above!</li>';
    return;
  }

  elements.list.innerHTML = transactions.map((transaction) => `
    <li class="transaction-item ${transaction.type}">
      <div class="transaction-info">
        <span class="transaction-desc">${transaction.description}</span>
        <span class="transaction-category">${transaction.category}</span>
      </div>
      <div class="transaction-right">
        <span class="transaction-amount">${transaction.type === 'income' ? '+' : '-'}${formatCurrency(transaction.amount)}</span>
        <button class="btn-delete" type="button" data-id="${transaction.id}" aria-label="Delete ${transaction.description}">✕</button>
      </div>
    </li>
  `).join('');
}

async function removeTransaction(transactionId) {
  if (!currentUser || !transactionId) {
    return;
  }

  await deleteDoc(doc(db, 'users', currentUser.uid, 'transactions', transactionId));
}

function subscribeToTransactions(userId) {
  if (unsubscribeTransactions) {
    unsubscribeTransactions();
  }

  const transactionsRef = collection(db, 'users', userId, 'transactions');
  const transactionsQuery = query(transactionsRef, orderBy('createdAt', 'desc'));

  unsubscribeTransactions = onSnapshot(
    transactionsQuery,
    (snapshot) => {
      transactions = snapshot.docs.map((entry) => {
        const data = entry.data();

        return {
          id: entry.id,
          description: data.description || 'Untitled',
          category: data.category || 'General',
          type: data.type === 'income' ? 'income' : 'expense',
          amount: Number(data.amount) || 0
        };
      });

      renderList();
      updateSummary();
      setPageMessage('');
    },
    () => {
      setPageMessage('Could not load transactions. Check your Firestore rules and network connection.', 'error');
    }
  );
}

async function handleTransactionSubmit(event) {
  event.preventDefault();

  if (!currentUser) {
    setPageMessage('You must be logged in to add transactions.', 'error');
    return;
  }

  const description = transactionFields.description.value.trim();
  const amount = parseFloat(transactionFields.amount.value);
  const category = transactionFields.category.value;
  const type = transactionFields.type.value;

  if (!description || Number.isNaN(amount) || amount <= 0) {
    setPageMessage('Enter a description and an amount greater than 0.', 'error');
    return;
  }

  try {
    await addDoc(collection(db, 'users', currentUser.uid, 'transactions'), {
      description,
      amount,
      category,
      type,
      createdAt: serverTimestamp()
    });

    elements.form.reset();
    setPageMessage('Transaction added.', 'success');
  } catch (error) {
    console.error('Failed to add transaction:', error);
    setPageMessage('Could not save that transaction.', 'error');
  }
}

async function handleTransactionDelete(event) {
  const button = event.target.closest('.btn-delete');
  if (!button) {
    return;
  }

  try {
    await removeTransaction(button.dataset.id);
    setPageMessage('Transaction deleted.', 'success');
  } catch (error) {
    console.error('Failed to delete transaction:', error);
    setPageMessage('Could not delete that transaction.', 'error');
  }
}

async function handleClearTransactions() {
  if (!currentUser || transactions.length === 0) {
    return;
  }

  if (!window.confirm('Clear all transactions?')) {
    return;
  }

  try {
    const batch = writeBatch(db);

    transactions.forEach((transaction) => {
      batch.delete(doc(db, 'users', currentUser.uid, 'transactions', transaction.id));
    });

    await batch.commit();
    setPageMessage('All transactions cleared.', 'success');
  } catch (error) {
    console.error('Failed to clear transactions:', error);
    setPageMessage('Could not clear transactions.', 'error');
  }
}

async function handleLogout() {
  try {
    await signOut(auth);
    window.location.href = 'login.html';
  } catch (error) {
    console.error('Failed to sign out:', error);
    setPageMessage('Could not sign out right now.', 'error');
  }
}

function handleAuthStateChanged(user) {
  if (!user) {
    if (unsubscribeTransactions) {
      unsubscribeTransactions();
      unsubscribeTransactions = null;
    }

    window.location.replace('login.html');
    return;
  }

  currentUser = user;
  elements.userEmail.textContent = user.email || user.displayName || 'Signed in';
  elements.userEmail.hidden = false;
  elements.authLink.hidden = true;
  elements.logoutButton.hidden = false;

  subscribeToTransactions(user.uid);
}

elements.form.addEventListener('submit', handleTransactionSubmit);
elements.list.addEventListener('click', handleTransactionDelete);
elements.clearButton.addEventListener('click', handleClearTransactions);
elements.logoutButton.addEventListener('click', handleLogout);

onAuthStateChanged(auth, handleAuthStateChanged);
