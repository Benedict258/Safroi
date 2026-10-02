import bcrypt from "bcryptjs";

const pw = process.argv[2];
if (!pw || pw.length < 10) {
  console.error("Usage: npm run hash-password -- '<password of at least 10 characters>'");
  process.exit(1);
}
// Single quotes keep the $ signs safe when pasted into a shell or an env file.
console.log(bcrypt.hashSync(pw, 12));
