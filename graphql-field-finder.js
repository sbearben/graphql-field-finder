// This is a script that looks for usage of a specific field in GraphQL
// queries in your codebase.
// 
// First, add a .graphqlconfig in your directory pointing to your schema
// Then, run the script with:
//
// node graphql-field-finder.js Field.name
//
// It will output a list of files and queries that contain the field you're
// looking for:
//
// src/filename.js:123 MyFavoriteQuery
//
// Please try this out and comment below! To learn more, check out the
// slides for the talk I gave about this here:
// https://www.slideshare.net/sashko1/building-custom-graphql-tooling-for-your-team

import { getGraphQLProjectConfig } from "graphql-config"
import { exec } from "child_process"
import { readFileSync } from "fs"
import { parse as parseJS } from "@babel/parser"
import traverse from "@babel/traverse"
import {
  parse as parseGraphQL,
  visit,
  visitWithTypeInfo,
  TypeInfo
} from "graphql";

const schema = getGraphQLProjectConfig().getSchema();
const desiredTypeDotField = getDesiredTypeDotField();

// Do a grep to find which files have GraphQL queries in them so we don't
// look through all JS in the whole app
exec(`git grep -rl "gql" -- '*.js' '*.jsx'`, (error, stdout, stderr) => {
  const files = stdout.split("\n").filter(filename => !!filename.length);

  const usages = files
    .map(filename => findGraphQLUsagesInFile(filename, desiredTypeDotField))
    .flat();

  console.log(
    usages
      .map(usage => `${usage.filename}:${usage.line} ${usage.operationName}`)
      .join("\n")
  );
});

// Given a filename and a Type.field name, read the file contents and return a
// list of operations/fragments where this field is used.
function findGraphQLUsagesInFile(filename, typeDotField) {
  const fileContents = readFileSync(filename, { encoding: "utf-8" });
  const ast = parseJS(fileContents, {
    sourceType: "module",
    plugins: ["jsx", "flow", "classProperties"]
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
    const ast = parseGraphQL(jsNode.value.raw);
    const typeInfo = new TypeInfo(schema);
    visit(
      ast,
      visitWithTypeInfo(typeInfo, {
        Field(graphqlNode) {
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
function getDesiredTypeDotField() {
  const desiredTypeDotField = process.argv[2];
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
