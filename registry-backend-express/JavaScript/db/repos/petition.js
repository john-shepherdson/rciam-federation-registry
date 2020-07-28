const sql = require('../sql').petition;
const {calcDiff} = require('../../functions/helpers.js');
const cs = {}; // Reusable ColumnSet objects.

/*
 This repository mixes hard-coded and dynamic SQL, primarily to show a diverse example of using both.
 */

class PetitionRepository {
  constructor(db, pgp) {
      this.db = db;
      this.pgp = pgp;
      // set-up all ColumnSet objects, if needed:
  }

  async get(id){
      return this.db.one(sql.getPetition,{
          id:+id,
        }).then(result => {
          if(result){
            let data = {};
            result.json.generate_client_secret = false;
            data.meta_data = {};
            data.meta_data.type = result.json.type;
            data.meta_data.requester = result.json.requester;
            data.meta_data.service_id = result.json.service_id;
            delete result.json.type;
            delete result.json.service_id;
            delete result.json.requester;
            data.service_data = result.json;
            return data
          }
        });
      }

  async add(petition,requester){
      try{
        return this.db.tx('add-service',async t =>{
          let queries = [];
          return await t.service_petition_details.add(petition,requester).then(async result=>{
            if(result){
              queries.push(t.service_details_protocol.add('petition',petition,result.id));
              queries.push(t.service_contacts.add('petition',petition.contacts,result.id));
              if(petition.protocol==='oidc'){
                queries.push(t.service_multi_valued.add('petition','oidc_grant_types',petition.grant_types,result.id));
                queries.push(t.service_multi_valued.add('petition','oidc_scopes',petition.scope,result.id));
                queries.push(t.service_multi_valued.add('petition','oidc_redirect_uris',petition.redirect_uris,result.id));
              }
              var result2 = await t.batch(queries);
              if(result2){
                return result.id
              }
            }
          });
        });
      }
      catch(error){
        return error
      }
    }

  async update(newState,targetId){
    try{
      return this.db.tx('update-service',async t =>{
        let queries = [];
        return t.petition.get(targetId).then(async oldState=>{
          if(oldState){
            console.log(oldState.service_data);
            console.log(newState);
            let edits = calcDiff(oldState.service_data,newState);
            if(Object.keys(edits.details).length !== 0){
               queries.push(t.service_petition_details.update(edits.details,targetId));
               queries.push(t.service_details_protocol.update('petition',edits.details,targetId));
            }
            for (var key in edits.add){
              if(key==='contacts') {
                queries.push(t.service_contacts.add('petition',edits.add[key],targetId));
              }
              else {
                queries.push(t.service_multi_valued.add('petition',key,edits.add[key],targetId));
              }
            }
            for (var key in edits.dlt){
              if(key==='contacts'){queries.push(t.service_contacts.delete_one_or_many('petition',edits.dlt[key],targetId));}
              else {queries.push(t.service_multi_valued.delete_one_or_many('petition',key,edits.dlt[key],targetId));}
            }
            var result = await t.batch(queries);
            if(result){
              return {success:true};
            }
          }
        }).catch(err =>{
          return {success:false,error:err}
        });
      });
    }
    catch(err){
      return {success:false,error:err}
    }
  }

}






//////////////////////////////////////////////////////////
// Example of statically initializing ColumnSet objects:



module.exports = PetitionRepository;