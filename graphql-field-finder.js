// This is a script that looks for usage of a specific field in GraphQL
// queries in your codebase.
// 
// First, add a .graphqlconfig in your directory pointing to your schema
// Then, run the script with (path can be relative or absolute):
//
// node graphql-field-finder.js "/path/to/repo" projectName Field.name
//
// It will output a list of files and queries that contain the field you're
// looking for:
//
// src/filename.js:123 MyFavoriteQuery

import { loadConfigSync } from "graphql-config"
import { exec } from "child_process"
import { readFileSync } from "fs"
import os from "os"
import { parse as parseJS } from "@babel/parser"
import _traverse from "@babel/traverse"
import {
  parse as parseGraphQL,
  visit,
  visitWithTypeInfo,
  TypeInfo
} from "graphql";
const traverse = _traverse.default;

const repoLocation = process.argv[2].replace("~", os.homedir);
const projectName = process.argv[3];
const fieldName = process.argv[4];

process.chdir(repoLocation)

const schema = loadConfigSync({
  filepath: `.graphqlconfig`,
}).getProject(projectName).getSchemaSync()

const desiredTypeDotField = getDesiredTypeDotField(fieldName);

// Do a grep to find which files have GraphQL queries in them so we don't
// look through all JS in the whole app
exec(`git grep -rl "gql" -- '*.ts' '*.tsx'`, (error, stdout, stderr) => {
  const files = stdout.split("\n").filter(filename => !!filename.length);

  const usages = files
    .map(filename => findGraphQLUsagesInFile(filename, desiredTypeDotField))
    .flat();

  console.log(
    usages
      // .map(usage => `${usage.filename}:${usage.line} ${usage.operationName}`)
      .map(usage => `${usage.filename}#L${usage.line}`)
      .join("\n")
  );
});

// Given a filename and a Type.field name, read the file contents and return a
// list of operations/fragments where this field is used.
function findGraphQLUsagesInFile(filename, typeDotField) {
  const fileContents = readFileSync(filename, { encoding: "utf-8" });
  const ast = parseJS(fileContents, {
    sourceType: "module",
    plugins: ["jsx", "typescript"]
  });

  const graphqlStringNodes = [];
  traverse(ast, {
    TaggedTemplateExpression: function(path) {
      if (path.node.tag.name === "gql") {
        graphqlStringNodes.push(path.node.quasi.quasis[0]);
      }
    }
  });

  const usages = [];
  graphqlStringNodes.forEach(jsNode => {
    let ast
    try {
      ast = parseGraphQL(jsNode.value.raw);  
    } catch(e) {
      console.error(`Error parsing: ${filename}\nOutput of parseGraphQL:\n${jsNode.value.raw}\n`)
      throw e
    }
    
    const typeInfo = new TypeInfo(schema);
    
    visit(
      ast,
      visitWithTypeInfo(typeInfo, {
        Field(graphqlNode) {
          if (!typeInfo.getParentType()) {
            return
          }
          
          const currentTypeDotField =
            typeInfo.getParentType().name + "." + graphqlNode.name.value;

          if (currentTypeDotField === typeDotField) {
            usages.push({
              filename,
              operationName: ast.definitions[0].name.value,
              line: jsNode.loc.start.line
            });
          }
        }
      })
    );
  });
  return usages;
}

// Get the first argument passed to this script and validate it a bit
function getDesiredTypeDotField(desiredTypeDotField) {
  if (!desiredTypeDotField) {
    throw new Error("Please supply a field name as Type.field");
  }

  const [typeName, fieldName] = desiredTypeDotField.split(".");
  if (!schema.getType(typeName)) {
    throw new Error(`Couldn't find type ${typeName} in schema.`);
  }
  if (!schema.getType(typeName).getFields()[fieldName]) {
    throw new Error(`Couldn't find field ${fieldName} on type ${typeName}.`);
  }
  return desiredTypeDotField;
}
