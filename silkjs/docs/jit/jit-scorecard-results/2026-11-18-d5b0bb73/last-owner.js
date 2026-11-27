function update(box, value, repeats) {
  let checksum = 0
  for (let i = 0; i < repeats; i++) {
    box.value = value
    checksum += i
  }
  return checksum
}
function runBatch(count) {
  let total = 0
  const box = { value: null }
  const next = { id: 17 }
  for (let i = 0; i < count; i++) {
    box.value = { id: i }
    total += update(box, next, 128) + box.value.id
  }
  return total
}
const say = typeof print === "function" ? print : console.log
const answer = runBatch(20000)
if (answer !== 162900000) throw Error("wrong checksum: " + answer)
say(answer)
