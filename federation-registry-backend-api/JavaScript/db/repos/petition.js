const sql = require('../sql').petition;
const {calcDiff,extractServiceBoolean} = require('../../functions/helpers.js');
const cs = {}; // Reusable ColumnSet objects.
const {sendMail} = require('../../functions/helpers.js');
/*
 This repository mixes hard-coded and dynamic SQL, primarily to show a diverse example of using both.
 */

class PetitionRepository {
  constructor(db, pgp) {
      this.db = db;
      this.pgp = pgp;
      // set-up all ColumnSet objects, if needed:
  }


  async get(id,tenant,user){
    return this.db.oneOrNone(sql.getPetition,{
      id:+id,
      tenant:tenant,
      hide_comments:!user.role.actions.includes('review_petition')
    }).then(result => {
      if(result){
        return fixPetition(result);
      }
      else {
        return null
      }
    })
  }
  async canReviewOwn(petition_id,sub){
    return this.db.oneOrNone(sql.canReviewOwn,{
      sub:sub,
      id:+petition_id
    })
  }
  async getOwnOld(id,tenant,user){
    return this.db.oneOrNone(sql.getOldOwnPetition,{
      sub:user.sub,
      id:+id,
      tenant:tenant,
      hide_comments:!user.role.actions.includes('review_petition')
    }).then(result => {
      if(result){
        return fixPetition(result);
      }
      else {
        return null
      }
    })
  }
  async getOld(id,tenant,user){
    return this.db.oneOrNone(sql.getOldPetition,{
      sub:user.sub,
      id:+id,
      tenant:tenant,
      hide_comments:!user.role.actions.includes('review_petition')
    }).then(result => {
      if(result){
        return fixPetition(result);
      }
      else {
        return null
      }
    })
  }

  async getLastStateId(id){
    return this.db.oneOrNone(sql.getLastStateId,{id:+id}).then(result=>{
      if(result){
        return result.id
      }
      else{
        return null;
      }
    })
  }

  async getOwn(id,tenant,user){
    return this.db.oneOrNone(sql.getOwnPetition,{
      sub:user.sub,
      id:+id,
      tenant:tenant,
      hide_comments:!user.role.actions.includes('review_petition')
    }).then(result => {
      if(result){
        return fixPetition(result);

      }
      else {
        return null
      }
    })
  }

  async add(petition,requester){
        return this.db.tx('add-service',async t =>{
          let queries = [];
          
            if(!petition.group_id&&petition.type==='create'){
              petition.group_id = await t.group.addGroup(requester);
            }
            return await t.service_petition_details.add(petition,requester).then(async result=>{
              if(result){
                queries.push(t.service_details_protocol.add('petition',petition,result.id));
                queries.push(t.service_contacts.add('petition',petition.contacts,result.id));
                queries.push(t.service_multi_valued.addServiceBoolean('petition',petition,result.id));
                if(petition.protocol==='oidc'){
                  queries.push(t.service_multi_valued.add('petition','oidc_grant_types',petition.grant_types,result.id));
                  queries.push(t.service_multi_valued.add('petition','oidc_scopes',petition.scope,result.id));
                  queries.push(t.service_multi_valued.add('petition','oidc_redirect_uris',petition.redirect_uris,result.id));
                  queries.push(t.service_multi_valued.add('petition','oidc_post_logout_redirect_uris',petition.post_logout_redirect_uris,result.id));

                }
                if(petition.protocol==='saml'){
                  queries.push(t.service_multi_valued.addSamlAttributes('petition',petition.requested_attributes,result.id));                  
                }
                var result2 = await t.batch(queries);
                if(result2){
                  return result.id
                }
              }
            });
          
        });
    }

  async update(newState,targetId,tenant,req){
    try{
      return this.db.tx('update-service',async t =>{
        let queries = [];
        return t.petition.get(targetId,tenant,req.user).then(async oldState=>{
          if(oldState){
            let edits = calcDiff(oldState.service_data,newState,tenant);
            if(Object.keys(edits.details).length !== 0){
               queries.push(t.service_petition_details.update(edits.details,targetId));
               queries.push(t.service_details_protocol.update('petition',edits.details,targetId));
            }
            for (var key in edits.add){
              if(key==='contacts') {
                queries.push(t.service_contacts.add('petition',edits.add[key],targetId));
              }
              else if(key==='requested_attributes'){queries.push(t.service_multi_valued.addSamlAttributes('petition',edits.add[key],targetId))}
              else if(key === 'service_boolean'){
                queries.push(t.service_multi_valued.addServiceBoolean('petition',{...edits.add[key],tenant:tenant},targetId));
              }
              else {
                queries.push(t.service_multi_valued.add('petition',key,edits.add[key],targetId));
              } 
            }
            for (var key in edits.update){
              if(key === 'service_boolean'){
                queries.push(t.service_multi_valued.updateServiceBoolean('petition',{...edits.update[key],tenant:tenant},targetId));                
              }
              else if(key==='requested_attributes'){queries.push(t.service_multi_valued.updateSamlAttributes('petition',edits.update[key],targetId))}              
            }
            for (var key in edits.dlt){
              if(key==='contacts'){queries.push(t.service_contacts.delete_one_or_many('petition',edits.dlt[key],targetId));}
              else if(key==='requested_attributes'){queries.push(t.service_multi_valued.deleteSamlAttributes('petition',edits.dlt[key],targetId))}
              else {queries.push(t.service_multi_valued.delete_one_or_many('petition',key,edits.dlt[key],targetId));}
            }
            var result = await t.batch(queries);
            if(result){
              if(oldState.meta_data.status==='changes'){
                await t.user.getUsersByAction('review_notification',tenant).then(users=>{
                  sendMail({subject:'New Petition to Review',service_name:newState.service_name,integration_environment:newState.integration_environment,tenant:tenant,url:(oldState.meta_data.service_id?"/services/"+oldState.meta_data.service_id:"")+"/requests/"+targetId+"/review"},'reviewer-notification.html',users);
                })
              }
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

const fixPetition = (result) => {
  let data = {};
  result.json.generate_client_secret = false;
  data.meta_data = {};
  data.meta_data.type = result.json.type;
  data.meta_data.comment = result.json.comment;
  data.meta_data.submitted_at = result.json.submitted_at;
  data.meta_data.group_id = result.json.group_id;
  data.meta_data.requester = result.json.requester;
  data.meta_data.service_id = result.json.service_id;
  data.meta_data.status = result.json.status;
  data.meta_data.reviewed_at = result.json.reviewed_at;

  delete result.group_id;
  delete result.json.status;
  delete result.json.reviewed_at;
  delete result.json.type;
  delete result.json.service_id;
  delete result.json.requester;
  delete result.json.comment;
  delete result.json.submitted_at;
  data.service_data = extractServiceBoolean(result.json);
  return data
}




//////////////////////////////////////////////////////////
// Example of statically initializing ColumnSet objects:



module.exports = PetitionRepository;
