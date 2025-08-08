const bcrypt = require('bcryptjs');

async function hashPassword() {
  // Use the exact password '123456'
  const hashedPassword = await bcrypt.hash('111111', 10);
  console.log(hashedPassword);
}

hashPassword();