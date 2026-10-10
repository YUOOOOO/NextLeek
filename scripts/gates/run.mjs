import ts from 'typescript'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

async function sources(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const lists = await Promise.all(entries.map(entry => entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith('.ts') ? [join(directory, entry.name)] : []))
  return lists.flat()
}
function effectAncestor(node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'effect') return true
  }
  return false
}
const failures = []
for (const path of await sources('src/host')) {
  const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true)
  function fail(node, message) {
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))
    failures.push(`${path}:${line + 1}: ${message}`)
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement)) {
      if (!(statement.declarationList.flags & ts.NodeFlags.Const)) fail(statement, 'Module state must be scoped to Context/plugin lifecycle, not let/var')
      for (const declaration of statement.declarationList.declarations) {
        if (declaration.initializer && ts.isNewExpression(declaration.initializer)) fail(declaration, 'Module-level mutable instances are forbidden')
      }
    }
    if (path.includes('/plugins/') && ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const name = statement.moduleSpecifier.text
      if (name.includes('/services/') && !name.endsWith('/contracts')) fail(statement, 'Plugins must inject interfaces, not import service implementations')
    }
  }
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const name = node.expression.name.text
      if (['on', 'once', 'addListener', 'handle', 'setInterval', 'setTimeout'].includes(name) && !effectAncestor(node)) fail(node, 'External registration must be owned by ctx.effect')
      if (name === 'plugin') {
        const argument = node.arguments[0]
        if (argument && ts.isObjectLiteralExpression(argument) && !argument.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'name')) fail(argument, 'Inline plugin must have a stable explicit name')
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && ['setInterval', 'setTimeout'].includes(node.expression.text) && !effectAncestor(node)) fail(node, 'Timers must be owned by ctx.effect')
    if (ts.isObjectLiteralExpression(node) && node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'plugin')) {
      if (!node.properties.some(property => ts.isPropertyAssignment(property) && property.name.getText(source) === 'id' && ts.isStringLiteral(property.initializer) && property.initializer.text)) fail(node, 'Plugin composition entry requires an explicit stable id')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1 }
else console.log('Architecture gates passed: scoped state, effect-owned registrations, injected plugin dependencies, explicit plugin IDs')
